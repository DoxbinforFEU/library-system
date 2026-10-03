<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
startSecureSession();

function findAuthByUsername(PDO $pdo, string $username): ?array {
    $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE username = ? OR email = ? LIMIT 1');
    $stmt->execute([$username, $username]);
    $row = $stmt->fetch();
    return $row ?: null;
}

if ($method === 'GET') {
    $action = getQueryParam('action', 'me');
    if ($action === 'status') {
        $cu = currentUser();
        if ($cu) {
            $chk = $pdo->prepare('SELECT status FROM auth_users WHERE id = ?');
            $chk->execute([(int)$cu['id']]);
            $st = $chk->fetchColumn();
            if ($st !== 'Active') {
                logoutUser();
                $cu = null;
            }
        }
        sendResponse([
            'authenticated' => (bool)$cu,
            'setupRequired' => librarianCount($pdo) === 0,
            'user' => $cu ? authPublicPayload(array_merge($cu, [
                'display_name' => $cu['displayName'],
                'patron_id' => $cu['patronId'],
                'avatar_data_url' => $cu['avatarDataUrl'],
                'avatar_preset' => $cu['avatarPreset'],
                'last_login' => $cu['lastLogin'],
            ])) : null,
        ]);
    }
    $user = requireAuth();
    $row = loadAuthUser($pdo, (int)$user['id']);
    sendResponse(['user' => authPublicPayload($row), 'account' => authPublicPayload($row)]);
}

if ($method !== 'POST') {
    sendError('Method not allowed', 405);
}

$data = getJsonBody();
$action = $data['action'] ?? getQueryParam('action', 'login');

if ($action === 'setup') {
    // Serialize concurrent first-run requests; the lock is released when the connection closes.
    $locked = (int)$pdo->query("SELECT GET_LOCK('feu_library_setup', 5)")->fetchColumn();
    if (!$locked) {
        sendError('Setup is already in progress. Try again.', 409);
    }
    if (librarianCount($pdo) > 0) {
        sendError('An administrator account already exists.', 409);
    }
    $errors = requireFields($data, ['username', 'email', 'password', 'displayName']);
    $username = strtolower(ltrim(trim((string)($data['username'] ?? '')), '@'));
    $email = trim((string)($data['email'] ?? ''));
    $password = (string)($data['password'] ?? '');
    $display = trim((string)($data['displayName'] ?? ''));
    if ($username && !preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
        $errors['username'] = 'Username must be 3–24 letters, numbers, dots or dashes.';
    }
    if ($email && !validateEmail($email)) {
        $errors['email'] = 'Enter a valid email.';
    }
    if (strlen($password) < 10) {
        $errors['password'] = 'Use at least 10 characters.';
    } elseif (strlen($password) > 72) {
        $errors['password'] = 'Use at most 72 characters.';
    }
    if (mb_strlen($display) < 2) {
        $errors['displayName'] = 'Enter a display name.';
    }
    if ($errors) {
        sendValidationError($errors);
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('
        INSERT INTO auth_users (username, email, password_hash, display_name, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([$username, $email, $hash, $display, 'admin', 'Active']);
    $row = loadAuthUser($pdo, (int)$pdo->lastInsertId());
    $session = loginUser($pdo, $row);
    sendResponse([
        'message' => 'Administrator account created.',
        'user' => authPublicPayload($row),
        'account' => authPublicPayload($row),
    ], 201);
}

if ($action === 'login') {
    $errors = requireFields($data, ['username', 'password']);
    if ($errors) {
        sendValidationError($errors);
    }
    $username = trim((string)$data['username']);
    $throttle = throttleKeys('login', $username);
    assertNotThrottled($throttle);

    $row = findAuthByUsername($pdo, $username);
    // Always run one hash verification so unknown usernames take the same time.
    $valid = password_verify((string)$data['password'], $row['password_hash'] ?? DUMMY_PASSWORD_HASH);
    if (!$row || !$valid) {
        recordThrottleFailure($throttle);
        sendError('Invalid username or password.', 401);
    }
    if ($row['status'] !== 'Active') {
        sendError('This account is inactive.', 403);
    }
    if (!in_array((string)$row['role'], staffRoles(), true)) {
        sendError('This portal is for administrators only.', 403);
    }
    clearThrottle($throttle);
    loginUser($pdo, $row);
    $fresh = loadAuthUser($pdo, (int)$row['id']);
    sendResponse([
        'message' => 'Signed in.',
        'user' => authPublicPayload($fresh),
        'account' => authPublicPayload($fresh),
    ]);
}

if ($action === 'logout') {
    logoutUser();
    sendResponse(['message' => 'Signed out.']);
}

if ($action === 'password') {
    $user = requireAuth();
    $errors = [];
    $current = (string)($data['currentPassword'] ?? '');
    $new = (string)($data['newPassword'] ?? '');
    $confirm = (string)($data['confirmPassword'] ?? $data['newPassword'] ?? '');
    if ($current === '') {
        $errors['currentPassword'] = 'Enter the current password.';
    }
    if (strlen($new) < 10) {
        $errors['newPassword'] = 'Use at least 10 characters.';
    } elseif (strlen($new) > 72) {
        $errors['newPassword'] = 'Use at most 72 characters.';
    }
    if ($new !== $confirm) {
        $errors['confirmPassword'] = 'Passwords do not match.';
    }
    if ($errors) {
        sendValidationError($errors);
    }
    $throttle = throttleKeys('password', (string)$user['id']);
    assertNotThrottled($throttle);
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row || !password_verify($current, $row['password_hash'])) {
        recordThrottleFailure($throttle);
        sendError('Current password is incorrect.', 400);
    }
    clearThrottle($throttle);
    $pdo->prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $row['id']]);
    session_regenerate_id(true);
    sendResponse(['message' => 'Password updated successfully.']);
}

sendError('Unknown action.', 400);