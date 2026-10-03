<?php
require __DIR__ . '/../config.php';

$actor = requireLibrarian();
$method = requestMethod();
if ($method !== 'GET') {
    sendError('Method not allowed', 405);
}

$settings = loadSettingsRow($pdo);
$today = todayManila();

$activity = [];
for ($i = 6; $i >= 0; $i--) {
    $day = (new DateTimeImmutable($today, new DateTimeZone(APP_TIMEZONE)))->modify("-{$i} days")->format('Y-m-d');
    $issued = $pdo->prepare("SELECT COUNT(*) FROM transactions WHERE type = 'issue' AND issue_date = ?");
    $issued->execute([$day]);
    $returned = $pdo->prepare("SELECT COUNT(*) FROM transactions WHERE type = 'issue' AND status = 'Returned' AND return_date = ?");
    $returned->execute([$day]);
    $label = (new DateTimeImmutable($day, new DateTimeZone(APP_TIMEZONE)))->format('D');
    $activity[] = [
        'date' => $day,
        'label' => $label,
        'issued' => (int)$issued->fetchColumn(),
        'returned' => (int)$returned->fetchColumn(),
    ];
}

$most = $pdo->query("
    SELECT book_id, book_title, COUNT(*) AS borrow_count
    FROM transactions
    WHERE type = 'issue' AND book_id IS NOT NULL
    GROUP BY book_id, book_title
    ORDER BY borrow_count DESC, book_title ASC
    LIMIT 8
")->fetchAll();

$overdueStmt = $pdo->query("
    SELECT t.*, b.due_date AS book_due
    FROM transactions t
    LEFT JOIN books b ON b.id = t.book_id
    WHERE t.type = 'issue'
      AND t.return_date IS NULL
      AND t.status IN ('Borrowed','Overdue')
      AND t.due_date IS NOT NULL
      AND t.due_date < CURDATE()
    ORDER BY t.due_date ASC
");
$overdue = [];
$totalEstFines = 0.0;
foreach ($overdueStmt as $row) {
    $mapped = mapTransaction($row);
    $days = overdueDays((string)$row['due_date'], $today);
    $est = calculateFineAmount((string)$row['due_date'], $today, $settings);
    $mapped['daysLate'] = $days;
    $mapped['estimatedFine'] = $est;
    $totalEstFines += $est;
    $overdue[] = $mapped;
}

$finesCollected = (float)$pdo->query("
    SELECT COALESCE(SUM(fine), 0)
    FROM transactions
    WHERE type = 'issue' AND status = 'Returned'
")->fetchColumn();

$openLoans = (int)$pdo->query("
    SELECT COUNT(*) FROM transactions
    WHERE type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue')
")->fetchColumn();

$recent = $pdo->query("
    SELECT * FROM transactions
    WHERE type = 'issue'
    ORDER BY COALESCE(return_date, issue_date) DESC, created_at DESC
    LIMIT 20
")->fetchAll();

sendResponse([
    'activity' => $activity,
    'mostBorrowed' => array_map(static function ($row) {
        return [
            'bookId' => $row['book_id'],
            'title' => $row['book_title'],
            'count' => (int)$row['borrow_count'],
        ];
    }, $most),
    'overdue' => $overdue,
    'totals' => [
        'openLoans' => $openLoans,
        'overdueCount' => count($overdue),
        'estimatedOverdueFines' => round($totalEstFines, 2),
        'finesCollected' => round($finesCollected, 2),
    ],
    'recent' => array_map('mapTransaction', $recent),
    'asOf' => $today,
]);
