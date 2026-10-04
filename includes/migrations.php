<?php

declare(strict_types=1);

require_once __DIR__ . '/schema_guard.php';

/** Id of the newest migration. Requests refuse to run until this one is recorded. */
const MIGRATION_LATEST = '005_open_loan_guard';

function tableExists(PDO $pdo, string $table): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
    $s->execute([$table]);
    return (int)$s->fetchColumn() > 0;
}

function foreignKeyExists(PDO $pdo, string $name): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?');
    $s->execute([$name]);
    return (int)$s->fetchColumn() > 0;
}

function checkConstraintExists(PDO $pdo, string $name): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?');
    $s->execute([$name]);
    return (int)$s->fetchColumn() > 0;
}

/** Cheap per-request gate: one indexed lookup. */
function migrationsApplied(PDO $pdo): bool {
    try {
        $s = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
        $s->execute([MIGRATION_LATEST]);
        return (bool)$s->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function migrationForeignKeys(): array {
    // [name, table, column, referenced table, ON DELETE action]
    return [
        ['fk_books_borrowed_by', 'books', 'borrowed_by', 'users', 'SET NULL'],
        ['fk_transactions_book', 'transactions', 'book_id', 'books', 'SET NULL'],
        ['fk_transactions_user', 'transactions', 'user_id', 'users', 'SET NULL'],
        ['fk_auth_patron', 'auth_users', 'patron_id', 'users', 'SET NULL'],
        ['fk_res_book', 'reservations', 'book_id', 'books', 'CASCADE'],
        ['fk_res_user', 'reservations', 'user_id', 'users', 'CASCADE'],
    ];
}

function migrationIndexes(): array {
    // [table, index name, columns]
    return [
        ['transactions', 'idx_tx_issue_date', 'issue_date'],
        ['transactions', 'idx_tx_return_date', 'return_date'],
        ['transactions', 'idx_tx_open', 'type, return_date, due_date'],
        ['books', 'idx_books_isbn', 'isbn'],
    ];
}

function migrationChecks(): array {
    // [constraint name, table, condition]
    return [
        ['chk_tx_nonneg', 'transactions', 'fine >= 0 AND renewal_count >= 0'],
        ['chk_books_renewals_nonneg', 'books', 'renewal_count >= 0'],
        ['chk_settings_limits', 'settings',
            'fine_per_day >= 0 AND loan_days >= 1 AND max_books_per_user >= 1 AND max_renewals >= 0 AND grace_period_days >= 0'],
    ];
}

function migrationList(): array {
    return [
        [
            'id' => '001_baseline',
            'title' => 'Baseline tables, columns, indexes, id counters (idempotent; no data removed)',
            'preflight' => function (PDO $pdo): array {
                $missing = [];
                foreach (['books', 'users', 'transactions', 'settings', 'notif_prefs'] as $t) {
                    if (!tableExists($pdo, $t)) {
                        $missing[] = "table `$t` is missing; import schema.sql first";
                    }
                }
                return $missing;
            },
            'apply' => function (PDO $pdo): void {
                ensureBaselineSchema($pdo);
            },
        ],
        [
            'id' => '002_foreign_keys',
            'title' => 'Add foreign keys that are not present yet',
            'preflight' => function (PDO $pdo): array {
                $problems = [];
                foreach (migrationForeignKeys() as [$name, $t, $col, $ref]) {
                    if (foreignKeyExists($pdo, $name)) {
                        continue;
                    }
                    $n = (int)$pdo->query("SELECT COUNT(*) FROM `$t` c LEFT JOIN `$ref` r ON r.id = c.`$col` WHERE c.`$col` IS NOT NULL AND r.id IS NULL")->fetchColumn();
                    if ($n > 0) {
                        $problems[] = "$name: $n row(s) in $t.$col point to a missing $ref record";
                    }
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                foreach (migrationForeignKeys() as [$name, $t, $col, $ref, $onDelete]) {
                    if (!foreignKeyExists($pdo, $name)) {
                        $pdo->exec("ALTER TABLE `$t` ADD CONSTRAINT `$name` FOREIGN KEY (`$col`) REFERENCES `$ref`(id) ON DELETE $onDelete ON UPDATE CASCADE");
                    }
                }
            },
        ],
        [
            'id' => '003_indexes',
            'title' => 'Add indexes for reports/notifications (transactions dates, books.isbn; non-unique)',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                foreach (migrationIndexes() as [$t, $name, $cols]) {
                    if (!indexExists($pdo, $t, $name)) {
                        $pdo->exec("CREATE INDEX `$name` ON `$t` ($cols)");
                    }
                }
            },
        ],
        [
            'id' => '004_check_constraints',
            'title' => 'Add non-negative / minimum-value CHECK constraints',
            'preflight' => function (PDO $pdo): array {
                $problems = [];
                foreach (migrationChecks() as [$name, $t, $cond]) {
                    if (checkConstraintExists($pdo, $name)) {
                        continue;
                    }
                    $n = (int)$pdo->query("SELECT COUNT(*) FROM `$t` WHERE NOT ($cond)")->fetchColumn();
                    if ($n > 0) {
                        $problems[] = "$name: $n row(s) in $t violate ($cond)";
                    }
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                foreach (migrationChecks() as [$name, $t, $cond]) {
                    if (!checkConstraintExists($pdo, $name)) {
                        $pdo->exec("ALTER TABLE `$t` ADD CONSTRAINT `$name` CHECK ($cond)");
                    }
                }
            },
        ],
        [
            'id' => '005_open_loan_guard',
            'title' => 'Database-enforced "one open loan per book" (virtual column + unique index)',
            'preflight' => function (PDO $pdo): array {
                $rows = $pdo->query("SELECT book_id, COUNT(*) c FROM transactions WHERE type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue') GROUP BY book_id HAVING c > 1")->fetchAll();
                $problems = [];
                foreach ($rows as $r) {
                    $problems[] = "book {$r['book_id']} has {$r['c']} open loans; resolve before the unique guard can be added";
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                if (!columnExists($pdo, 'transactions', 'open_book_id')) {
                    $pdo->exec("ALTER TABLE transactions ADD COLUMN open_book_id VARCHAR(20) GENERATED ALWAYS AS (IF(type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue'), book_id, NULL)) VIRTUAL");
                }
                if (!indexExists($pdo, 'transactions', 'uk_tx_open_book')) {
                    $pdo->exec('CREATE UNIQUE INDEX uk_tx_open_book ON transactions (open_book_id)');
                }
            },
        ],
    ];
}

/**
 * Applies pending migrations in order. $dryRun reports only and changes nothing.
 * Stops at the first migration whose preflight finds blocking data (live run).
 * Returns ['applied' => [...ids], 'pending' => [...ids], 'blocked' => bool].
 */
function runMigrations(PDO $pdo, bool $dryRun, callable $log): array {
    $applied = [];
    $done = [];
    if (!$dryRun) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(64) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }
    if (tableExists($pdo, 'schema_migrations')) {
        $done = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
    }
    $pending = [];
    $blocked = false;
    foreach (migrationList() as $m) {
        if (in_array($m['id'], $done, true)) {
            $log("  [done]    {$m['id']}");
            continue;
        }
        $pending[] = $m['id'];
        $problems = ($m['preflight'])($pdo);
        if ($problems) {
            $blocked = true;
            $log("  [BLOCKED] {$m['id']}: {$m['title']}");
            foreach ($problems as $p) {
                $log("            - $p");
            }
            if (!$dryRun) {
                break;
            }
            continue;
        }
        if ($dryRun) {
            $log("  [pending] {$m['id']}: {$m['title']}");
            continue;
        }
        $log("  [apply]   {$m['id']}: {$m['title']}");
        ($m['apply'])($pdo);
        $pdo->prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (?)')->execute([$m['id']]);
        $applied[] = $m['id'];
    }
    return ['applied' => $applied, 'pending' => $dryRun ? $pending : array_values(array_diff($pending, $applied)), 'blocked' => $blocked];
}
