<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

function fetchBook(PDO $pdo, string $id, bool $forUpdate = false): ?array {
    $sql = 'SELECT * FROM books WHERE id = ? AND deleted_at IS NULL' . ($forUpdate ? ' FOR UPDATE' : '');
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

if ($method === 'GET') {
    $id = getQueryParam('id');
    if ($id) {
        $row = fetchBook($pdo, (string)$id);
        if (!$row) {
            sendError('Book not found', 404);
        }
        sendResponse(['book' => mapBook($row), 'books' => [mapBook($row)]]);
    }

    [$limit, $offset] = paginationParams(100, 200);
    $status = getQueryParam('status');
    $category = getQueryParam('category');
    $search = likeTerm(getQueryParam('search'));
    $sort = getQueryParam('sort', 'id');

    $where = ['deleted_at IS NULL'];
    $params = [];
    if ($status) {
        if ($status === 'Overdue') {
            $where[] = "status IN ('Borrowed','Overdue') AND due_date IS NOT NULL AND due_date < CURDATE()";
        } elseif ($status === 'Borrowed') {
            $where[] = "status IN ('Borrowed','Overdue') AND (due_date IS NULL OR due_date >= CURDATE())";
        } elseif ($status === 'Available') {
            $where[] = "status = 'Available'";
        }
    }
    if ($category) {
        $where[] = 'category = ?';
        $params[] = $category;
    }
    if ($search) {
        $where[] = '(title LIKE ? ESCAPE \'\\\\\' OR author LIKE ? ESCAPE \'\\\\\' OR isbn LIKE ? ESCAPE \'\\\\\' OR location LIKE ? ESCAPE \'\\\\\')';
        array_push($params, $search, $search, $search, $search);
    }
    $whereSql = implode(' AND ', $where);
    $total = countRows($pdo, "SELECT COUNT(*) FROM books WHERE $whereSql", $params);

    $order = 'id ASC';
    if ($sort === 'created' || $sort === 'newest') {
        $order = 'created_at DESC, id DESC';
    } elseif ($sort === 'title') {
        $order = 'title ASC';
    }

    $query = "SELECT * FROM books WHERE $whereSql ORDER BY $order LIMIT ? OFFSET ?";
    $params[] = $limit;
    $params[] = $offset;
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $books = array_map('mapBook', $stmt->fetchAll());
    sendResponse(['books' => $books, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

function updateBookRow(PDO $pdo, string $id, array $data): void {
    $existing = fetchBook($pdo, $id);
    if (!$existing) {
        sendError('Book not found', 404);
    }

    $allowed = [
        'title' => 'title',
        'author' => 'author',
        'category' => 'category',
        'isbn' => 'isbn',
        'year' => 'year',
        'location' => 'location',
        'description' => 'description',
        'format' => 'format',
        'cover' => 'cover_url',
        'cover_url' => 'cover_url',
    ];
    $errors = [];
    $fields = [];
    $params = [];

    foreach ($allowed as $in => $col) {
        if (!array_key_exists($in, $data)) {
            continue;
        }
        $value = $data[$in];
        if ($col === 'title' || $col === 'author') {
            $value = validateStringLength($value, 1, 255, $in, $errors);
        } elseif ($col === 'category') {
            $value = validateEnum($value, BOOK_CATEGORIES, 'category', $errors, true);
        } elseif ($col === 'format') {
            $value = validateEnum($value, BOOK_FORMATS, 'format', $errors, true);
        } elseif ($col === 'isbn') {
            $value = trim((string)$value);
            if ($value !== '' && !validateIsbn($value)) {
                $errors['isbn'] = 'Enter a valid ISBN.';
            }
            $value = $value === '' ? null : $value;
        } elseif ($col === 'year') {
            $value = validateYear($value, $errors);
        } elseif ($col === 'location') {
            $value = validateStringLength($value, 0, 20, 'location', $errors, false);
            $value = $value === '' ? null : $value;
        } elseif ($col === 'description') {
            $value = $value === '' || $value === null ? null : mb_substr(trim((string)$value), 0, 4000);
        } elseif ($col === 'cover_url') {
            $value = $value === '' || $value === null ? null : mb_substr(trim((string)$value), 0, 2000);
        }
        $fields[] = "`$col` = ?";
        $params[] = $value === '' ? null : $value;
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = $id;
    $pdo->prepare('UPDATE books SET ' . implode(', ', $fields) . ' WHERE id = ? AND deleted_at IS NULL')->execute($params);
    $get = fetchBook($pdo, $id);
    sendResponse(['message' => 'Book updated successfully', 'book' => mapBook($get)]);
}

if ($method === 'POST') {
    requireLibrarian();
    $data = getJsonBody();
    $errors = requireFields($data, ['title', 'author']);
    $title = validateStringLength($data['title'] ?? '', 1, 255, 'title', $errors);
    $author = validateStringLength($data['author'] ?? '', 1, 255, 'author', $errors);
    $category = validateEnum($data['category'] ?? null, BOOK_CATEGORIES, 'category', $errors, true);
    $format = validateEnum($data['format'] ?? null, BOOK_FORMATS, 'format', $errors, true);
    $isbn = trim((string)($data['isbn'] ?? ''));
    if ($isbn !== '' && !validateIsbn($isbn)) {
        $errors['isbn'] = 'Enter a valid ISBN.';
    }
    $year = validateYear($data['year'] ?? null, $errors);
    $location = validateStringLength($data['location'] ?? '', 0, 20, 'location', $errors, false);
    $description = isset($data['description']) ? mb_substr(trim((string)$data['description']), 0, 4000) : null;
    $cover = $data['cover'] ?? $data['cover_url'] ?? null;
    $cover = $cover === '' ? null : $cover;
    if ($errors) {
        sendValidationError($errors);
    }

    $pdo->beginTransaction();
    try {
        $newId = nextBookId($pdo);
        $stmt = $pdo->prepare('
            INSERT INTO books (id, title, author, category, isbn, year, location, status,
              description, format, cover_url, renewal_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ');
        $stmt->execute([
            $newId,
            $title,
            $author,
            $category,
            $isbn === '' ? null : $isbn,
            $year,
            $location === '' ? null : $location,
            'Available',
            $description === '' ? null : $description,
            $format,
            $cover,
        ]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    $get = fetchBook($pdo, $newId);
    sendResponse([
        'message' => 'Book created successfully',
        'id' => $newId,
        'book' => mapBook($get),
    ], 201);
}

if ($method === 'PUT') {
    requireLibrarian();
    $data = getJsonBody();
    $id = getQueryParam('id') ?: ($data['id'] ?? null);
    if (!$id) {
        sendError('Book ID is required', 400);
    }
    updateBookRow($pdo, (string)$id, $data);
}

if ($method === 'DELETE') {
    requireLibrarian();
    $id = getQueryParam('id');
    if (!$id) {
        sendError('Book ID is required', 400);
    }
    $book = fetchBook($pdo, (string)$id);
    if (!$book) {
        sendError('Book not found', 404);
    }
    $status = effectiveLoanStatus($book['status'], $book['due_date'] ?? null);
    if (in_array($status, ['Borrowed', 'Overdue'], true)) {
        sendError('Cannot delete a book that is currently on loan', 400);
    }
    $pdo->prepare('UPDATE books SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
    sendResponse(['message' => 'Book deleted successfully']);
}

sendError('Method not allowed', 405);
