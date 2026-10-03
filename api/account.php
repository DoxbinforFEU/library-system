<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$user = requireAuth();

if ($method === 'GET') {
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row) {
        sendError('Account not found', 404);
    }
    sendResponse(['account' => authPublicPayload($row)]);
}

if ($method === 'PUT' || $method === 'POST') {
    $data = getJsonBody();
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row) {
        sendError('Account not found', 404);
    }

    $errors = [];
    $fields = [];
    $params = [];

    if (array_key_exists('displayName', $data)) {
        $name = validateStringLength($data['displayName'], 2, 255, 'displayName', $errors);
        if (!$errors) {
            $fields[] = 'display_name = ?';
            $params[] = $name;
        }
    }
    if (array_key_exists('username', $data)) {
        $username = strtolower(ltrim(trim((string)$data['username']), '@'));
        if (!preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
            $errors['username'] = 'Username must be 3–24 letters, numbers, dots or dashes.';
        } else {
            $dup = $pdo->prepare('SELECT id FROM auth_users WHERE username = ? AND id <> ?');
            $dup->execute([$username, $row['id']]);
            if ($dup->fetch()) {
                $errors['username'] = 'That username is already in use.';
            } else {
                $fields[] = 'username = ?';
                $params[] = $username;
            }
        }
    }
    if (array_key_exists('email', $data)) {
        $email = trim((string)$data['email']);
        if (!validateEmail($email)) {
            $errors['email'] = 'Enter a valid email.';
        } else {
            $dup = $pdo->prepare('SELECT id FROM auth_users WHERE email = ? AND id <> ?');
            $dup->execute([$email, $row['id']]);
            if ($dup->fetch()) {
                $errors['email'] = 'That email is already in use.';
            } else {
                $fields[] = 'email = ?';
                $params[] = $email;
            }
        }
    }
    if (array_key_exists('avatarDataUrl', $data)) {
        $avatar = validateAvatarDataUrl($data['avatarDataUrl']);
        $fields[] = 'avatar_data_url = ?';
        $params[] = $avatar;
    }
    if (array_key_exists('avatarPreset', $data)) {
        $preset = $data['avatarPreset'] === '' || $data['avatarPreset'] === null ? null : (string)$data['avatarPreset'];
        $fields[] = 'avatar_preset = ?';
        $params[] = $preset;
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = $row['id'];
    $pdo->prepare('UPDATE auth_users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    $fresh = loadAuthUser($pdo, (int)$row['id']);
    $_SESSION['user'] = sessionFromRow($fresh);
    sendResponse([
        'message' => 'Account updated successfully',
        'account' => authPublicPayload($fresh),
    ]);
}

sendError('Method not allowed', 405);
