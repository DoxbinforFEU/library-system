<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

if ($method === 'GET') {
    $userId = getQueryParam('user_id') ?: getQueryParam('userId');
    $bookId = getQueryParam('book_id') ?: getQueryParam('bookId');
    if (!isLibrarian($actor)) {
        $userId = $actor['patronId'] ?? '__none__';
    }
    $where = ["status = 'active'"];
    $params = [];
    if ($userId) {
        $where[] = 'user_id = ?';
        $params[] = $userId;
    }
    if ($bookId) {
        $where[] = 'book_id = ?';
        $params[] = $bookId;
    }
    $sql = 'SELECT * FROM reservations WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = array_map(static function ($row) {
        return [
            'id' => $row['id'],
            'bookId' => $row['book_id'],
            'userId' => $row['user_id'],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
        ];
    }, $stmt->fetchAll());
    sendResponse(['reservations' => $rows]);
}

if ($method !== 'POST') {
    sendError('Method not allowed', 405);
}

$data = getJsonBody();
$action = $data['action'] ?? 'create';
$bookId = $data['bookId'] ?? $data['book_id'] ?? null;
$userId = $data['userId'] ?? $data['user_id'] ?? $actor['patronId'] ?? null;
if (!isLibrarian($actor)) {
    $userId = $actor['patronId'] ?? null;
}
if (!$bookId || !$userId) {
    sendError('Book and patron are required.', 400);
}

$pdo->beginTransaction();
try {
    if ($action === 'cancel') {
        $pdo->prepare("UPDATE reservations SET status = 'cancelled' WHERE book_id = ? AND user_id = ? AND status = 'active'")
            ->execute([$bookId, $userId]);
        $pdo->commit();
        sendResponse(['message' => 'Reservation cancelled.']);
    }

    $bookStmt = $pdo->prepare('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $bookStmt->execute([$bookId]);
    $book = $bookStmt->fetch();
    if (!$book) {
        $pdo->rollBack();
        sendError('Book not found', 404);
    }
    if ($book['status'] === 'Available') {
        $pdo->rollBack();
        sendError('This title is available. Borrow it instead of reserving.', 400);
    }
    $userStmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL');
    $userStmt->execute([$userId]);
    $patron = $userStmt->fetch();
    if (!$patron || $patron['status'] !== 'Active') {
        $pdo->rollBack();
        sendError('Patron is not eligible to reserve.', 400);
    }
    $dup = $pdo->prepare("SELECT id FROM reservations WHERE book_id = ? AND user_id = ? AND status = 'active' FOR UPDATE");
    $dup->execute([$bookId, $userId]);
    if ($dup->fetch()) {
        $pdo->rollBack();
        sendError('You already have an active reservation for this title.', 409);
    }
    $id = nextReservationId($pdo);
    $pdo->prepare('INSERT INTO reservations (id, book_id, user_id, status) VALUES (?, ?, ?, ?)')
        ->execute([$id, $bookId, $userId, 'active']);
    $pdo->commit();
    sendResponse(['message' => 'Reservation placed.', 'id' => $id], 201);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}
