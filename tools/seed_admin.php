<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../includes/bootstrap.php';

if (strtolower((string)$APP_ENV) !== 'development') {
    fwrite(STDERR, "Refusing to seed the test administrator unless APP_ENV=development.\n");
    exit(1);
}

require_once __DIR__ . '/../includes/schema_guard.php';
ensureAdminRoleEnum($pdo);
require_once __DIR__ . '/../includes/dev_seed.php';

$password = developmentAdminPassword();
if ($password === null) {
    fwrite(STDERR, "Set DEV_ADMIN_PASSWORD in the local .env file before seeding the administrator.\n");
    exit(1);
}

$pdo->beginTransaction();
try {
    $find = $pdo->prepare('SELECT id FROM auth_users WHERE username = ? LIMIT 1 FOR UPDATE');
    $find->execute([DEV_ADMIN_USERNAME]);
    $existingId = $find->fetchColumn();
    $hash = password_hash($password, PASSWORD_DEFAULT);

    if ($existingId !== false) {
        $update = $pdo->prepare("
            UPDATE auth_users
            SET password_hash = ?, display_name = ?, role = 'admin', status = 'Active'
            WHERE id = ?
        ");
        $update->execute([$hash, DEV_ADMIN_DISPLAY, $existingId]);
    } else {
        $email = $pdo->prepare('SELECT id FROM auth_users WHERE email = ? LIMIT 1');
        $email->execute([DEV_ADMIN_EMAIL]);
        if ($email->fetchColumn() !== false) {
            throw new RuntimeException('The development seed email is already assigned to another account.');
        }

        $insert = $pdo->prepare("
            INSERT INTO auth_users (username, email, password_hash, display_name, role, status)
            VALUES (?, ?, ?, ?, 'admin', 'Active')
        ");
        $insert->execute([
            DEV_ADMIN_USERNAME,
            DEV_ADMIN_EMAIL,
            $hash,
            DEV_ADMIN_DISPLAY,
        ]);
    }

    $pdo->commit();
    fwrite(STDOUT, "Development administrator 'admin' is ready. Password stored as a password_hash() hash.\n");
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}
