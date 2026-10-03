<?php

declare(strict_types=1);

const BOOK_CATEGORIES = [
    'Literature', 'Science', 'History', 'Philosophy', 'Technology', 'Psychology',
    'Arts', 'Business', 'Mathematics', 'Computer Science', 'Education', 'Social Sciences',
];
const BOOK_FORMATS = ['Hardcover', 'Paperback', 'E-book', 'Audiobook'];
const USER_STATUSES = ['Active', 'Inactive'];
const AUTH_ROLES = ['admin', 'librarian', 'patron'];
const DATE_FORMATS = ['short', 'long', 'iso'];
const TIME_FORMATS = ['12h', '24h'];
const PAGE_SIZES = [10, 25, 50, 100];
const DENSITIES = ['comfortable', 'compact'];
const LANDING_PAGES = ['dashboard', 'books', 'users', 'issue', 'reports'];

function getJsonBody(): array {
    static $cached = null;
    if ($cached === null) {
        $raw = file_get_contents('php://input');
        if ($raw !== false && strlen($raw) > 2_000_000) {
            sendError('Request payload is too large.', 413);
        }
        $decoded = json_decode($raw ?: '[]', true);
        $cached = is_array($decoded) ? $decoded : [];
    }
    return $cached;
}

function requestMethod(): string {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function getQueryParam(string $name, $default = null) {
    return $_GET[$name] ?? $default;
}

function toBool($value): bool {
    if (is_bool($value)) {
        return $value;
    }
    $normalized = strtolower(trim((string)$value));
    return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
}

function todayManila(): string {
    return (new DateTimeImmutable('now', new DateTimeZone(APP_TIMEZONE)))->format('Y-m-d');
}

function isValidDate(string $value): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        return false;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $value, new DateTimeZone(APP_TIMEZONE));
    return $dt && $dt->format('Y-m-d') === $value;
}

function requireFields(array $data, array $required): array {
    $errors = [];
    foreach ($required as $field) {
        if (!isset($data[$field]) || $data[$field] === '' || $data[$field] === null) {
            $errors[$field] = 'This field is required.';
        }
    }
    return $errors;
}

function clampInt($value, int $min, int $max, int $fallback): int {
    if (!is_numeric($value)) {
        return $fallback;
    }
    $n = (int)$value;
    return max($min, min($max, $n));
}

function paginationParams(int $defaultLimit = 50, int $maxLimit = 200): array {
    $limit = clampInt(getQueryParam('limit', $defaultLimit), 1, $maxLimit, $defaultLimit);
    $offset = max(0, (int)getQueryParam('offset', 0));
    return [$limit, $offset];
}

function likeTerm(?string $search): ?string {
    if ($search === null || trim($search) === '') {
        return null;
    }
    $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($search));
    return '%' . $escaped . '%';
}

function validateEmail(string $email): bool {
    return (bool)filter_var($email, FILTER_VALIDATE_EMAIL);
}

function validateIsbn(?string $isbn): bool {
    if ($isbn === null || $isbn === '') {
        return true;
    }
    $digits = preg_replace('/[^0-9Xx]/', '', $isbn);
    $len = strlen($digits);
    return $len === 10 || $len === 13;
}

function validateYear($year, array &$errors, string $key = 'year'): ?int {
    if ($year === null || $year === '') {
        return null;
    }
    if (!is_numeric($year)) {
        $errors[$key] = 'Year must be a number.';
        return null;
    }
    $y = (int)$year;
    if ($y < -2000 || $y > 2100) {
        $errors[$key] = 'Year is out of range.';
        return $y;
    }
    return $y;
}

function validateEnum($value, array $allowed, string $key, array &$errors, bool $optional = false) {
    if ($value === null || $value === '') {
        if (!$optional) {
            $errors[$key] = 'This field is required.';
        }
        return null;
    }
    if (!in_array($value, $allowed, true)) {
        $errors[$key] = 'Invalid value.';
        return null;
    }
    return $value;
}

function validateStringLength($value, int $min, int $max, string $key, array &$errors, bool $required = true): string {
    $text = trim((string)$value);
    if ($text === '') {
        if ($required) {
            $errors[$key] = 'This field is required.';
        }
        return '';
    }
    $len = mb_strlen($text);
    if ($len < $min || $len > $max) {
        $errors[$key] = "Must be between {$min} and {$max} characters.";
    }
    return $text;
}

function validateAvatarDataUrl($value): ?string {
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value) || !preg_match('#^data:image/(jpeg|jpg|png|webp);base64,#i', $value, $m)) {
        sendError('Avatar must be a JPEG, PNG, or WebP image.', 400);
    }
    $raw = substr($value, strpos($value, ',') + 1);
    $bin = base64_decode($raw, true);
    if ($bin === false || $bin === '') {
        sendError('Avatar image data is invalid.', 400);
    }
    if (strlen($bin) > 400_000) {
        sendError('Avatar is too large. Use a smaller photo.', 400);
    }
    $info = @getimagesizefromstring($bin);
    if ($info === false) {
        sendError('Avatar is not a valid image.', 400);
    }
    $mime = $info['mime'] ?? '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        sendError('Avatar must be a JPEG, PNG, or WebP image.', 400);
    }
    return $value;
}
