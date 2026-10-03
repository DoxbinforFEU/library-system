<?php
// CLI: php tests/stage1_auth_test.php  (needs php-sqlite3 for the requireAuth checks)
declare(strict_types=1);
class Stop extends Exception { public $code2; public $extra; }
function sendError(string $m, int $c = 400, array $extra = []): void { $e = new Stop($m); $e->code2 = $c; $e->extra = $extra; throw $e; }
function sendResponse($d, int $c = 200): void {}
require __DIR__ . '/../includes/auth.php';
$ok = 0; $fail = 0;
function check(string $name, bool $cond) { global $ok, $fail; $cond ? $ok++ : $fail++; echo ($cond ? "PASS " : "FAIL ") . $name . "\n"; }
function expectErr(callable $f): ?Stop { try { $f(); } catch (Stop $e) { return $e; } return null; }

// --- throttle
$_SERVER['REMOTE_ADDR'] = '10.0.0.' . random_int(1, 250) . random_int(1,9);
$u = 'user' . bin2hex(random_bytes(3));
$keys = throttleKeys('login', $u);
check('not throttled initially', expectErr(fn() => assertNotThrottled($keys)) === null);
for ($i = 0; $i < 4; $i++) recordThrottleFailure($keys);
check('4 failures still allowed', expectErr(fn() => assertNotThrottled($keys)) === null);
recordThrottleFailure($keys);
$e = expectErr(fn() => assertNotThrottled($keys));
check('5th failure blocks with 429', $e && $e->code2 === 429 && ($e->extra['retryAfter'] ?? 0) > 0);
$other = throttleKeys('login', 'someoneelse');
check('different username same ip not blocked', expectErr(fn() => assertNotThrottled($other)) === null);
check('username case-insensitive', expectErr(fn() => assertNotThrottled(throttleKeys('login', strtoupper($u)))) !== null);
clearThrottle($keys);
check('success clears per-user key', expectErr(fn() => assertNotThrottled($keys)) === null);
// window expiry
recordThrottleFailure($keys); 
$f = throttleFile($keys[0]['key']); file_put_contents($f, json_encode(['count' => 99, 'first' => time() - THROTTLE_WINDOW - 5]));
check('expired window resets', expectErr(fn() => assertNotThrottled($keys)) === null);
// per-ip limit
$ipKeys = throttleKeys('login', 'x1'); 
for ($i = 0; $i < THROTTLE_MAX_PER_IP; $i++) recordThrottleFailure(throttleKeys('login', 'n' . $i));
check('per-ip limit blocks new username', expectErr(fn() => assertNotThrottled(throttleKeys('login', 'brandnew'))) !== null);
foreach (glob(sys_get_temp_dir() . '/feu_throttle_*.json') as $g) unlink($g);

// --- dummy hash valid + timing equalizer
check('dummy hash is valid bcrypt', password_get_info(DUMMY_PASSWORD_HASH)['algoName'] === 'bcrypt' && !password_verify('x', DUMMY_PASSWORD_HASH));

// --- requireAuth against sqlite
if (extension_loaded('pdo_sqlite')) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE auth_users (id INTEGER PRIMARY KEY, role TEXT, status TEXT)");
    $pdo->exec("INSERT INTO auth_users VALUES (1,'admin','Active'),(2,'patron','Active')");
    ob_start();
    session_save_path(sys_get_temp_dir());
    $_SESSION = [];
    startSecureSession();
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active'];
    check('active admin passes requireLibrarian', requireLibrarian()['role'] === 'admin');
    $pdo->exec("UPDATE auth_users SET role='patron' WHERE id=1");
    $e = expectErr(fn() => requireLibrarian());
    check('role demoted in DB -> 403 immediately', $e && $e->code2 === 403);
    $pdo->exec("UPDATE auth_users SET role='admin', status='Inactive' WHERE id=1");
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active'];
    $e = expectErr(fn() => requireAuth());
    check('deactivated in DB -> 401 and session cleared', $e && $e->code2 === 401 && !isset($_SESSION['user']));
    startSecureSession();
    $_SESSION['user'] = ['id' => 99, 'role' => 'admin', 'status' => 'Active'];
    $e = expectErr(fn() => requireAuth());
    check('deleted account -> 401', $e && $e->code2 === 401);
    $_SESSION = [];
    $e = expectErr(fn() => requireAuth());
    check('no session -> 401', $e && $e->code2 === 401);
    ob_end_clean();
} else { echo "SKIP requireAuth tests (no pdo_sqlite)\n"; }

// --- same-origin guard
$_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';
check('same-origin POST allowed', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['HTTP_ORIGIN'] = 'http://evil.example';
$e = expectErr(fn() => assertSameOrigin());
check('cross-site POST blocked 403', $e && $e->code2 === 403);
$_SERVER['HTTP_HOST'] = 'localhost:8080'; $_SERVER['HTTP_ORIGIN'] = 'http://localhost:8080';
check('same-origin with port allowed', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';
check('different port blocked', expectErr(fn() => assertSameOrigin()) !== null);
unset($_SERVER['HTTP_ORIGIN']);
check('missing Origin allowed (non-browser)', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['HTTP_ORIGIN'] = 'http://evil.example';
check('GET never blocked', expectErr(fn() => assertSameOrigin()) === null);
echo "\n$ok passed, $fail failed\n";
