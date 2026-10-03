<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

function userExists(PDO $pdo, string $id): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL');
    $stmt->execute([$id]);
    return (bool)$stmt->fetchColumn();
}

function fetchUsersPayload(PDO $pdo, $id = null, $status = null, $search = null, $limit = 50, $offset = 0, &$total = 0): array {
    $where = ['deleted_at IS NULL'];
    $params = [];
    if ($id) {
        $where[] = 'id = ?';
        $params[] = $id;
    }
    if ($status) {
        $where[] = 'status = ?';
        $params[] = $status;
    }
    $like = likeTerm($search);
    if ($like) {
        $where[] = '(first_name LIKE ? ESCAPE \'\\\\\' OR last_name LIKE ? ESCAPE \'\\\\\' OR contact LIKE ? ESCAPE \'\\\\\' OR program LIKE ? ESCAPE \'\\\\\' OR id LIKE ? ESCAPE \'\\\\\')';
        array_push($params, $like, $like, $like, $like, $like);
    }
    $whereSql = implode(' AND ', $where);
    $total = countRows($pdo, "SELECT COUNT(*) FROM users WHERE $whereSql", $params);

    $query = "SELECT * FROM users WHERE $whereSql ORDER BY last_name ASC, first_name ASC LIMIT ? OFFSET ?";
    $exec = $params;
    $exec[] = $limit;
    $exec[] = $offset;
    $stmt = $pdo->prepare($query);
    $stmt->execute($exec);
    $rows = $stmt->fetchAll();
    $borrowed = borrowedIdsByUser($pdo, array_column($rows, 'id'));
    $users = [];
    foreach ($rows as $row) {
        $users[] = mapUser($row, $borrowed[$row['id']] ?? []);
    }
    return $users;
}

function updateUser(PDO $pdo, string $id, array $data): void {
    if (!userExists($pdo, $id)) {
        sendError('User not found', 404);
    }
    $errors = [];
    $fields = [];
    $params = [];

    if (array_key_exists('lastName', $data) || array_key_exists('last_name', $data)) {
        $lastName = validateStringLength($data['lastName'] ?? $data['last_name'] ?? '', 1, 100, 'lastName', $errors);
        $fields[] = 'last_name = ?';
        $params[] = $lastName;
    }
    if (array_key_exists('firstName', $data) || array_key_exists('first_name', $data)) {
        $firstName = validateStringLength($data['firstName'] ?? $data['first_name'] ?? '', 1, 100, 'firstName', $errors);
        $fields[] = 'first_name = ?';
        $params[] = $firstName;
    }
    if (array_key_exists('middleInitial', $data) || array_key_exists('middle_initial', $data)) {
        $mi = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($data['middleInitial'] ?? $data['middle_initial'] ?? '')), 0, 1));
        $fields[] = 'middle_initial = ?';
        $params[] = $mi;
    }
    if (array_key_exists('program', $data)) {
        $fields[] = 'program = ?';
        $params[] = validateStringLength($data['program'], 0, 100, 'program', $errors, false) ?: null;
    }
    if (array_key_exists('yearLevel', $data) || array_key_exists('year_level', $data)) {
        $year = $data['yearLevel'] ?? $data['year_level'];
        if ($year === '' || $year === null) {
            $fields[] = 'year_level = ?';
            $params[] = null;
        } else {
            $y = (int)$year;
            if ($y < 1 || $y > 5) {
                $errors['yearLevel'] = 'Year level must be between 1 and 5.';
            }
            $fields[] = 'year_level = ?';
            $params[] = $y;
        }
    }
    if (array_key_exists('contact', $data)) {
        $contact = trim((string)$data['contact']);
        if (!validateEmail($contact)) {
            $errors['contact'] = 'Contact must be a valid email address.';
        } else {
            $dup = $pdo->prepare('SELECT id FROM users WHERE contact = ? AND id <> ? AND deleted_at IS NULL');
            $dup->execute([$contact, $id]);
            if ($dup->fetch()) {
                $errors['contact'] = 'That email is already registered.';
            }
            $fields[] = 'contact = ?';
            $params[] = $contact;
        }
    }
    if (array_key_exists('status', $data)) {
        $status = validateEnum($data['status'], USER_STATUSES, 'status', $errors);
        if ($status) {
            $fields[] = 'status = ?';
            $params[] = $status;
        }
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = $id;
    $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ? AND deleted_at IS NULL')->execute($params);
    $total = 0;
    $users = fetchUsersPayload($pdo, $id, null, null, 1, 0, $total);
    sendResponse(['message' => 'User updated successfully', 'user' => $users[0]]);
}

if ($method === 'GET') {
    if (!isLibrarian($actor) && getQueryParam('id') && getQueryParam('id') !== ($actor['patronId'] ?? '')) {
        requireLibrarian();
    }
    if (!isLibrarian($actor) && !getQueryParam('id')) {
        requireLibrarian();
    }
    $id = getQueryParam('id');
    [$limit, $offset] = paginationParams(25, 200);
    $total = 0;
    $users = fetchUsersPayload($pdo, $id, getQueryParam('status'), getQueryParam('search'), $limit, $offset, $total);
    if ($id && empty($users)) {
        sendError('User not found', 404);
    }
    if ($id) {
        sendResponse(['user' => $users[0], 'users' => $users, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }
    sendResponse(['users' => $users, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

if ($method === 'PUT') {
    requireLibrarian();
    $data = getJsonBody();
    $id = getQueryParam('id') ?: ($data['id'] ?? null);
    if (!$id) {
        sendError('User ID is required', 400);
    }
    updateUser($pdo, (string)$id, $data);
}

if ($method === 'POST') {
    requireLibrarian();
    $data = getJsonBody();
    $errors = [];
    $lastName = validateStringLength($data['lastName'] ?? $data['last_name'] ?? '', 1, 100, 'lastName', $errors);
    $firstName = validateStringLength($data['firstName'] ?? $data['first_name'] ?? '', 1, 100, 'firstName', $errors);
    $middleInitial = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($data['middleInitial'] ?? $data['middle_initial'] ?? '')), 0, 1));
    $program = validateStringLength($data['program'] ?? '', 0, 100, 'program', $errors, false);
    $yearLevel = $data['yearLevel'] ?? $data['year_level'] ?? null;
    if ($yearLevel !== null && $yearLevel !== '') {
        $yearLevel = (int)$yearLevel;
        if ($yearLevel < 1 || $yearLevel > 5) {
            $errors['yearLevel'] = 'Year level must be between 1 and 5.';
        }
    } else {
        $yearLevel = null;
    }
    $contact = trim((string)($data['contact'] ?? ''));
    if (!validateEmail($contact)) {
        $errors['contact'] = 'Contact must be a valid email address.';
    } else {
        $dup = $pdo->prepare('SELECT id FROM users WHERE contact = ? AND deleted_at IS NULL');
        $dup->execute([$contact]);
        if ($dup->fetch()) {
            $errors['contact'] = 'That email is already registered.';
        }
    }
    $status = validateEnum($data['status'] ?? 'Active', USER_STATUSES, 'status', $errors);
    if ($errors) {
        sendValidationError($errors);
    }

    $pdo->beginTransaction();
    try {
        $newId = nextUserId($pdo);
        $stmt = $pdo->prepare('
            INSERT INTO users (id, last_name, first_name, middle_initial, program, year_level, contact, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $newId,
            $lastName,
            $firstName,
            $middleInitial,
            $program === '' ? null : $program,
            $yearLevel,
            $contact,
            $status,
        ]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    $total = 0;
    $users = fetchUsersPayload($pdo, $newId, null, null, 1, 0, $total);
    sendResponse([
        'message' => 'User created successfully',
        'id' => $newId,
        'user' => $users[0],
    ], 201);
}

if ($method === 'DELETE') {
    requireLibrarian();
    $id = getQueryParam('id');
    if (!$id) {
        sendError('User ID is required', 400);
    }
    if (!userExists($pdo, (string)$id)) {
        sendError('User not found', 404);
    }
    $loan = $pdo->prepare("SELECT COUNT(*) FROM books WHERE borrowed_by = ? AND status IN ('Borrowed','Overdue') AND deleted_at IS NULL");
    $loan->execute([$id]);
    if ((int)$loan->fetchColumn() > 0) {
        sendError("Can't remove a patron with active loans", 400);
    }
    $pdo->prepare('UPDATE users SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
    sendResponse(['message' => 'User deleted successfully']);
}

sendError('Method not allowed', 405);
