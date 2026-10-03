<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$user = $method === 'GET' ? requireAuth() : requireLibrarian();

function loadSettings(PDO $pdo): array {
    return mapSettings(loadSettingsRow($pdo));
}

if ($method === 'GET') {
    sendResponse(['settings' => loadSettings($pdo)]);
}

if ($method === 'PUT' || $method === 'POST') {
    $data = getJsonBody();
    if (($data['action'] ?? '') === 'reset') {
        $data = [
            'finePerDay' => 10,
            'loanDays' => 7,
            'maxBooksPerUser' => 5,
            'maxRenewals' => 2,
            'gracePeriodDays' => 1,
            'overdueFinesEnabled' => true,
            'dateFormat' => 'short',
            'timeFormat' => '12h',
            'pageSize' => 25,
            'language' => 'en',
            'confirmDeletes' => true,
            'landingPage' => 'dashboard',
            'density' => 'comfortable',
            'libraryName' => 'FEU Roosevelt Library',
            'libraryEmail' => 'library@feuroosevelt.edu.ph',
            'libraryPhone' => '(02) 8373-0701',
            'libraryAddress' => 'Circumferential Road, Cainta, Rizal',
        ];
    }

    $errors = [];
    $fieldMap = [
        'finePerDay' => ['fine_per_day', 'number'],
        'loanDays' => ['loan_days', 'int'],
        'maxBooksPerUser' => ['max_books_per_user', 'int'],
        'maxRenewals' => ['max_renewals', 'int'],
        'gracePeriodDays' => ['grace_period_days', 'int'],
        'overdueFinesEnabled' => ['overdue_fines_enabled', 'bool'],
        'dateFormat' => ['date_format', 'enum'],
        'timeFormat' => ['time_format', 'enum'],
        'pageSize' => ['page_size', 'int'],
        'language' => ['language', 'lang'],
        'confirmDeletes' => ['confirm_deletes', 'bool'],
        'landingPage' => ['landing_page', 'enum'],
        'density' => ['density', 'enum'],
        'libraryName' => ['library_name', 'str'],
        'libraryEmail' => ['library_email', 'email'],
        'libraryPhone' => ['library_phone', 'str'],
        'libraryAddress' => ['library_address', 'str'],
    ];

    $fields = [];
    $params = [];
    foreach ($fieldMap as $camel => [$col, $kind]) {
        if (!array_key_exists($camel, $data)) {
            continue;
        }
        $value = $data[$camel];
        if ($kind === 'number') {
            if (!is_numeric($value) || (float)$value < 0) {
                $errors[$camel] = 'Must be 0 or more.';
                continue;
            }
            $value = round((float)$value, 2);
        } elseif ($kind === 'int') {
            $min = in_array($camel, ['maxRenewals', 'gracePeriodDays'], true) ? 0 : 1;
            if (!is_numeric($value) || (int)$value < $min) {
                $errors[$camel] = "Must be {$min} or more.";
                continue;
            }
            $value = (int)$value;
            if ($camel === 'pageSize' && !in_array($value, PAGE_SIZES, true)) {
                $errors[$camel] = 'Invalid page size.';
                continue;
            }
        } elseif ($kind === 'bool') {
            $value = toBool($value) ? 1 : 0;
        } elseif ($kind === 'email') {
            $value = trim((string)$value);
            if ($value !== '' && !validateEmail($value)) {
                $errors[$camel] = 'Enter a valid email.';
                continue;
            }
            $value = $value === '' ? null : $value;
        } elseif ($kind === 'enum') {
            $allowed = [
                'dateFormat' => DATE_FORMATS,
                'timeFormat' => TIME_FORMATS,
                'landingPage' => LANDING_PAGES,
                'density' => DENSITIES,
            ][$camel];
            $value = validateEnum($value, $allowed, $camel, $errors);
            if ($value === null) {
                continue;
            }
        } elseif ($kind === 'lang') {
            $value = 'en';
        } elseif ($kind === 'str') {
            $required = $camel === 'libraryName';
            $value = validateStringLength($value, $required ? 2 : 0, 255, $camel, $errors, $required);
            if ($value === '' && !$required) {
                $value = null;
            }
        }
        $fields[] = "$col = ?";
        $params[] = $value;
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = 1;
    $pdo->prepare('UPDATE settings SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    sendResponse([
        'message' => 'Settings updated successfully',
        'settings' => loadSettings($pdo),
    ]);
}

sendError('Method not allowed', 405);
