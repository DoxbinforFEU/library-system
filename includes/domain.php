<?php

declare(strict_types=1);

function formatUserName($lastName, $firstName, $middleInitial): string {
    $mi = $middleInitial ? (' ' . $middleInitial . '.') : '';
    return $lastName . ', ' . $firstName . $mi;
}

function loadSettingsRow(PDO $pdo): array {
    $stmt = $pdo->prepare('SELECT * FROM settings WHERE id = 1');
    $stmt->execute();
    $row = $stmt->fetch();
    if (!$row) {
        sendError('Settings not found', 404);
    }
    return $row;
}

function calculateFineAmount(string $dueDate, string $returnDate, array $settings): float {
    if (!toBool($settings['overdue_fines_enabled'] ?? true)) {
        return 0.0;
    }
    $tz = new DateTimeZone(APP_TIMEZONE);
    $due = DateTimeImmutable::createFromFormat('Y-m-d', $dueDate, $tz);
    $ret = DateTimeImmutable::createFromFormat('Y-m-d', $returnDate, $tz);
    if (!$due || !$ret) {
        return 0.0;
    }
    $overdueDays = (int)$due->diff($ret)->format('%r%a');
    $overdueDays = max(0, $overdueDays);
    $grace = max(0, (int)($settings['grace_period_days'] ?? 0));
    $billable = max(0, $overdueDays - $grace);
    $rate = max(0.0, (float)($settings['fine_per_day'] ?? 0));
    return round($billable * $rate, 2);
}

function addDaysIso(string $date, int $days): string {
    return (new DateTimeImmutable($date, new DateTimeZone(APP_TIMEZONE)))
        ->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
}

function overdueDays(string $dueDate, ?string $asOf = null): int {
    $asOf = $asOf ?: todayManila();
    $tz = new DateTimeZone(APP_TIMEZONE);
    $due = DateTimeImmutable::createFromFormat('Y-m-d', $dueDate, $tz);
    $day = DateTimeImmutable::createFromFormat('Y-m-d', $asOf, $tz);
    if (!$due || !$day) {
        return 0;
    }
    return max(0, (int)$due->diff($day)->format('%r%a'));
}

function effectiveLoanStatus(string $stored, ?string $dueDate, ?string $returnDate = null): string {
    if ($returnDate || $stored === 'Returned') {
        return 'Returned';
    }
    if ($dueDate && overdueDays($dueDate) > 0 && in_array($stored, ['Borrowed', 'Overdue'], true)) {
        return 'Overdue';
    }
    if (in_array($stored, ['Borrowed', 'Overdue'], true)) {
        return 'Borrowed';
    }
    return $stored;
}

function nextPrefixedId(PDO $pdo, string $counter, string $prefix, int $pad): string {
    $stmt = $pdo->prepare('SELECT next_value FROM id_counters WHERE name = ? FOR UPDATE');
    $stmt->execute([$counter]);
    $row = $stmt->fetch();
    if (!$row) {
        $pdo->prepare('INSERT INTO id_counters (name, next_value) VALUES (?, 2)')->execute([$counter]);
        $n = 1;
    } else {
        $n = (int)$row['next_value'];
        $pdo->prepare('UPDATE id_counters SET next_value = next_value + 1 WHERE name = ?')->execute([$counter]);
    }
    return $prefix . str_pad((string)$n, $pad, '0', STR_PAD_LEFT);
}

function nextBookId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'books', 'BK-', 4);
}

function nextUserId(PDO $pdo): string {
    $year = (new DateTimeImmutable('now', new DateTimeZone(APP_TIMEZONE)))->format('Y');
    return nextPrefixedId($pdo, 'users', $year . '-', 3);
}

function nextTxId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'transactions', 'TX-', 4);
}

function nextReservationId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'reservations', 'RV-', 4);
}

function mapBook(array $row): array {
    $status = effectiveLoanStatus($row['status'], $row['due_date'] ?? null);
    if (($row['status'] ?? '') === 'Available') {
        $status = 'Available';
    }
    return [
        'id' => $row['id'],
        'title' => $row['title'],
        'author' => $row['author'],
        'category' => $row['category'],
        'isbn' => $row['isbn'],
        'year' => $row['year'] === null ? null : (int)$row['year'],
        'location' => $row['location'],
        'status' => $status,
        'borrowedBy' => $row['borrowed_by'],
        'issueDate' => $row['issue_date'],
        'dueDate' => $row['due_date'],
        'description' => $row['description'],
        'format' => $row['format'],
        'cover' => $row['cover_url'],
        'createdAt' => $row['created_at'] ?? null,
        'renewalCount' => isset($row['renewal_count']) ? (int)$row['renewal_count'] : 0,
    ];
}

function mapUser(array $row, array $borrowedBookIds = []): array {
    return [
        'id' => $row['id'],
        'lastName' => $row['last_name'],
        'firstName' => $row['first_name'],
        'middleInitial' => $row['middle_initial'] ?? '',
        'name' => formatUserName($row['last_name'], $row['first_name'], $row['middle_initial'] ?? ''),
        'program' => $row['program'],
        'yearLevel' => $row['year_level'] === null ? null : (int)$row['year_level'],
        'contact' => $row['contact'],
        'status' => $row['status'],
        'borrowedBookIds' => array_values($borrowedBookIds),
    ];
}

function mapTransaction(array $row): array {
    $status = effectiveLoanStatus($row['status'], $row['due_date'] ?? null, $row['return_date'] ?? null);
    return [
        'id' => $row['id'],
        'type' => $row['type'],
        'bookId' => $row['book_id'],
        'bookTitle' => $row['book_title'],
        'userId' => $row['user_id'],
        'userName' => $row['user_name'],
        'issueDate' => $row['issue_date'],
        'dueDate' => $row['due_date'],
        'returnDate' => $row['return_date'],
        'fine' => (float)$row['fine'],
        'status' => $status,
        'renewalCount' => isset($row['renewal_count']) ? (int)$row['renewal_count'] : 0,
        'createdAt' => $row['created_at'] ?? null,
    ];
}

function mapSettings(array $row): array {
    return [
        'finePerDay' => (float)$row['fine_per_day'],
        'loanDays' => (int)$row['loan_days'],
        'maxBooksPerUser' => (int)$row['max_books_per_user'],
        'maxRenewals' => (int)$row['max_renewals'],
        'gracePeriodDays' => (int)$row['grace_period_days'],
        'overdueFinesEnabled' => toBool($row['overdue_fines_enabled']),
        'dateFormat' => $row['date_format'],
        'timeFormat' => $row['time_format'],
        'pageSize' => (int)$row['page_size'],
        'language' => $row['language'],
        'confirmDeletes' => toBool($row['confirm_deletes']),
        'landingPage' => $row['landing_page'],
        'density' => $row['density'],
        'libraryName' => $row['library_name'],
        'libraryEmail' => $row['library_email'],
        'libraryPhone' => $row['library_phone'],
        'libraryAddress' => $row['library_address'],
    ];
}

function mapAccount(array $row): array {
    $last = $row['last_login'] ?? null;
    $lastIso = null;
    if ($last) {
        $dt = new DateTimeImmutable($last, new DateTimeZone(APP_TIMEZONE));
        $lastIso = $dt->format('c');
    }
    return [
        'id' => $row['id'] ?? null,
        'displayName' => $row['display_name'],
        'username' => $row['username'],
        'email' => $row['email'],
        'role' => $row['role'],
        'status' => $row['status'],
        'patronId' => $row['patron_id'] ?? null,
        'avatarDataUrl' => $row['avatar_data_url'] ?? null,
        'avatarPreset' => $row['avatar_preset'] ?? null,
        'lastLogin' => $lastIso,
    ];
}

function mapNotifPrefs(array $row): array {
    return [
        'due' => toBool($row['due_notification']),
        'overdue' => toBool($row['overdue_notification']),
        'newUser' => toBool($row['new_user_notification']),
        'returns' => toBool($row['returns_notification']),
        'system' => toBool($row['system_notification']),
    ];
}

function borrowedIdsByUser(PDO $pdo, array $userIds): array {
    $result = [];
    foreach ($userIds as $id) {
        $result[$id] = [];
    }
    if (empty($userIds)) {
        return $result;
    }
    $placeholders = implode(',', array_fill(0, count($userIds), '?'));
    $stmt = $pdo->prepare("
        SELECT id, borrowed_by, status, due_date
        FROM books
        WHERE borrowed_by IN ($placeholders)
          AND deleted_at IS NULL
          AND status IN ('Borrowed', 'Overdue')
    ");
    $stmt->execute(array_values($userIds));
    foreach ($stmt->fetchAll() as $row) {
        $result[$row['borrowed_by']][] = $row['id'];
    }
    return $result;
}

function countRows(PDO $pdo, string $sql, array $params): int {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (int)$stmt->fetchColumn();
}