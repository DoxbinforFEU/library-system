<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

if ($method === 'GET') {
    $id = getQueryParam('id');
    $userId = getQueryParam('user_id') ?: getQueryParam('userId');
    $bookId = getQueryParam('book_id') ?: getQueryParam('bookId');
    $status = getQueryParam('status');
    $type = getQueryParam('type');
    [$limit, $offset] = paginationParams(50, 200);

    if (!isLibrarian($actor)) {
        $userId = $actor['patronId'] ?? '__none__';
    }

    $where = ['1=1'];
    $params = [];
    if ($id) {
        $where[] = 'id = ?';
        $params[] = $id;
    }
    if ($userId) {
        $where[] = 'user_id = ?';
        $params[] = $userId;
    }
    if ($bookId) {
        $where[] = 'book_id = ?';
        $params[] = $bookId;
    }
    if ($status === 'Overdue') {
        $where[] = "status IN ('Borrowed','Overdue') AND due_date IS NOT NULL AND due_date < CURDATE() AND return_date IS NULL";
    } elseif ($status === 'Borrowed') {
        $where[] = "status IN ('Borrowed','Overdue') AND return_date IS NULL AND (due_date IS NULL OR due_date >= CURDATE())";
    } elseif ($status === 'open') {
        $where[] = "status IN ('Borrowed','Overdue') AND return_date IS NULL";
    } elseif ($status) {
        $where[] = 'status = ?';
        $params[] = $status;
    }
    if ($type) {
        $where[] = 'type = ?';
        $params[] = $type;
    }

    $whereSql = implode(' AND ', $where);
    $total = countRows($pdo, "SELECT COUNT(*) FROM transactions WHERE $whereSql", $params);
    $query = "SELECT * FROM transactions WHERE $whereSql ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?";
    $params[] = $limit;
    $params[] = $offset;
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $transactions = array_map('mapTransaction', $stmt->fetchAll());
    sendResponse(['transactions' => $transactions, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

if ($method !== 'POST') {
    sendError('Method not allowed', 405);
}

// Circulation changes are staff-only. Patron accounts cannot sign in to this portal.
requireLibrarian();

/** Roll back any open transaction, then send the error (sendError exits). */
function failTx(PDO $pdo, string $message, int $status = 400, array $extra = []): void {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError($message, $status, $extra);
}

function lockBook(PDO $pdo, string $bookId): ?array {
    $stmt = $pdo->prepare('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $stmt->execute([$bookId]);
    return $stmt->fetch() ?: null;
}

function lockOpenLoan(PDO $pdo, string $bookId): ?array {
    $stmt = $pdo->prepare("
        SELECT * FROM transactions
        WHERE book_id = ? AND type = 'issue' AND status IN ('Borrowed','Overdue') AND return_date IS NULL
        ORDER BY id DESC LIMIT 1
        FOR UPDATE
    ");
    $stmt->execute([$bookId]);
    return $stmt->fetch() ?: null;
}

function loadTransactionRow(PDO $pdo, string $id): array {
    $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch();
}

function idField(array $data, array $keys): string {
    foreach ($keys as $k) {
        if (isset($data[$k]) && is_scalar($data[$k]) && trim((string)$data[$k]) !== '') {
            return trim((string)$data[$k]);
        }
    }
    return '';
}

$data = getJsonBody();
$type = $data['type'] ?? '';
if (!in_array($type, ['issue', 'return', 'renew'], true)) {
    sendError('Invalid transaction type. Use "issue", "return", or "renew".', 400);
}

$settings = loadSettingsRow($pdo);
$today = todayManila();
$loanDays = max(1, (int)$settings['loan_days']);

$bookId = idField($data, ['bookId', 'book_id']);
if ($bookId === '') {
    sendValidationError(['bookId' => 'Book ID is required.']);
}
if (strlen($bookId) > 20) {
    sendValidationError(['bookId' => 'Invalid book ID.']);
}

try {
    if ($type === 'issue') {
        // The issue date is always today (server clock, Asia/Manila); any client value is ignored.
        $userId = idField($data, ['userId', 'user_id']);
        if ($userId === '' || strlen($userId) > 20) {
            sendValidationError(['userId' => 'Patron ID is required.']);
        }
        $issueDate = $today;
        $maxDue = addDaysIso($issueDate, $loanDays);
        $dueRaw = $data['dueDate'] ?? $data['due_date'] ?? null;
        if ($dueRaw === null || $dueRaw === '') {
            $dueDate = $maxDue;
        } else {
            $dueDate = (string)$dueRaw;
            if (!isValidDate($dueDate)) {
                sendError('Enter a valid due date.', 422, ['errors' => ['dueDate' => 'Enter a valid due date.']]);
            }
            if ($dueDate < $issueDate) {
                sendError('Due date cannot be before today.', 422, ['errors' => ['dueDate' => 'Due date cannot be before today.']]);
            }
            if ($dueDate > $maxDue) {
                $msg = "Due date cannot be more than {$loanDays} days from today.";
                sendError($msg, 422, ['errors' => ['dueDate' => $msg]]);
            }
        }

        $pdo->beginTransaction();
        // Lock order is always book first, then patron, so concurrent requests cannot deadlock.
        $book = lockBook($pdo, $bookId);
        if (!$book) {
            failTx($pdo, 'Book not found', 404);
        }
        if ($book['status'] !== 'Available') {
            failTx($pdo, 'This book is not available for borrowing.', 409);
        }
        if (lockOpenLoan($pdo, $bookId)) {
            failTx($pdo, 'This title already has an open loan.', 409);
        }

        $userStmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
        $userStmt->execute([$userId]);
        $patron = $userStmt->fetch();
        if (!$patron) {
            failTx($pdo, 'User not found', 404);
        }
        if ($patron['status'] !== 'Active') {
            failTx($pdo, 'User is not active.', 409);
        }

        // The patron row lock above makes this count safe against parallel issues to the same patron.
        $maxBooks = (int)$settings['max_books_per_user'];
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM books WHERE borrowed_by = ? AND status IN ('Borrowed','Overdue') AND deleted_at IS NULL");
        $countStmt->execute([$userId]);
        if ((int)$countStmt->fetchColumn() >= $maxBooks) {
            failTx($pdo, 'Loan limit reached (' . $maxBooks . ' books per patron).', 409);
        }

        $txId = nextTxId($pdo);
        $userName = formatUserName($patron['last_name'], $patron['first_name'], $patron['middle_initial']);
        $pdo->prepare('
            INSERT INTO transactions (id, type, book_id, book_title, user_id, user_name,
              issue_date, due_date, fine, status, renewal_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ')->execute([$txId, 'issue', $bookId, $book['title'], $userId, $userName, $issueDate, $dueDate, 0, 'Borrowed']);

        $pdo->prepare('UPDATE books SET status = ?, borrowed_by = ?, issue_date = ?, due_date = ?, renewal_count = 0 WHERE id = ?')
            ->execute(['Borrowed', $userId, $issueDate, $dueDate, $bookId]);
        $pdo->prepare("UPDATE reservations SET status = 'fulfilled' WHERE book_id = ? AND user_id = ? AND status = 'active'")
            ->execute([$bookId, $userId]);

        $pdo->commit();
        sendResponse([
            'message' => 'Book issued successfully',
            'id' => $txId,
            'transaction' => mapTransaction(loadTransactionRow($pdo, $txId)),
        ], 201);
    }

    if ($type === 'renew') {
        $pdo->beginTransaction();
        $book = lockBook($pdo, $bookId);
        if (!$book) {
            failTx($pdo, 'Book not found', 404);
        }
        $open = lockOpenLoan($pdo, $bookId);
        if (!$open) {
            failTx($pdo, 'No open loan found for this book.', 409);
        }
        if ($open['due_date'] !== null && $open['due_date'] < $today) {
            failTx($pdo, 'Overdue loans cannot be renewed. Return the book and settle the fine first.', 409);
        }
        $maxRenewals = (int)$settings['max_renewals'];
        if ((int)($open['renewal_count'] ?? 0) >= $maxRenewals) {
            failTx($pdo, 'Renewal limit reached for this loan.', 409);
        }
        $newDue = addDaysIso($today, $loanDays);
        $pdo->prepare('UPDATE transactions SET due_date = ?, status = ?, renewal_count = renewal_count + 1 WHERE id = ?')
            ->execute([$newDue, 'Borrowed', $open['id']]);
        $pdo->prepare('UPDATE books SET due_date = ?, status = ?, renewal_count = renewal_count + 1 WHERE id = ?')
            ->execute([$newDue, 'Borrowed', $bookId]);
        $pdo->commit();
        sendResponse([
            'message' => 'Loan renewed successfully',
            'transaction' => mapTransaction(loadTransactionRow($pdo, $open['id'])),
        ]);
    }

    // return: closes the open issue row; no second ledger row is inserted.
    // The fine is always computed here; client-supplied fine/status/title fields are ignored.
    $userId = idField($data, ['userId', 'user_id']);
    $returnDate = $data['returnDate'] ?? $data['return_date'] ?? null;
    $returnDate = ($returnDate === null || $returnDate === '') ? $today : (string)$returnDate;
    if (!isValidDate($returnDate)) {
        sendError('Enter a valid return date.', 422, ['errors' => ['returnDate' => 'Enter a valid return date.']]);
    }
    if ($returnDate > $today) {
        sendError('Return date cannot be in the future.', 422, ['errors' => ['returnDate' => 'Return date cannot be in the future.']]);
    }

    $pdo->beginTransaction();
    $book = lockBook($pdo, $bookId);
    if (!$book) {
        failTx($pdo, 'Book not found', 404);
    }
    $open = lockOpenLoan($pdo, $bookId);
    if (!$open) {
        failTx($pdo, 'This book is not currently on loan (it may already have been returned).', 409);
    }
    if ($userId !== '' && $open['user_id'] && $userId !== $open['user_id']) {
        failTx($pdo, 'Patron does not match the active loan.', 409);
    }
    if ($returnDate < (string)$open['issue_date']) {
        $msg = 'Return date cannot be before the issue date.';
        failTx($pdo, $msg, 422, ['errors' => ['returnDate' => $msg]]);
    }

    $fine = calculateFineAmount((string)$open['due_date'], $returnDate, $settings);
    $daysLate = overdueDays((string)$open['due_date'], $returnDate);
    $pdo->prepare('UPDATE transactions SET status = ?, return_date = ?, fine = ? WHERE id = ?')
        ->execute(['Returned', $returnDate, $fine, $open['id']]);
    $pdo->prepare('UPDATE books SET status = ?, borrowed_by = NULL, issue_date = NULL, due_date = NULL, renewal_count = 0 WHERE id = ?')
        ->execute(['Available', $bookId]);
    $pdo->commit();

    sendResponse([
        'message' => 'Book returned successfully',
        'id' => $open['id'],
        'transaction' => mapTransaction(loadTransactionRow($pdo, $open['id'])),
        'fine' => $fine,
        'daysOverdue' => $daysLate,
    ]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($e instanceof PDOException && in_array((int)($e->errorInfo[1] ?? 0), [1205, 1213], true)) {
        sendError('That record is busy. Please try again.', 409);
    }
    throw $e;
}