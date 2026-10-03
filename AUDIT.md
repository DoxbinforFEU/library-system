# FEU Roosevelt Library Audit

**Status:** The database was recovered to a separate XAMPP data directory and the application login was verified. The original data directory remains preserved.

## Critical issues

None confirmed.

## High-priority findings and fixes

| Finding | Status | Evidence / change |
|---|---|---|
| The dashboard was bootstrapped without checking the server session; there was no sign-in UI. | Fixed | The browser now checks `api/auth.php?action=status`, shows a sign-in screen when unauthenticated, and loads dashboard data only after a successful staff login. |
| Logout and password-change controls only displayed prototype messages. | Fixed | Both sign-out controls now call the session logout endpoint. Password changes now call the password endpoint and enforce its 10-character minimum in the UI. |
| The default administrator and fictional demo catalog were seeded from normal API startup in every environment. The seed also reactivated/promoted an existing `admin` account on requests. | Fixed | Automatic development seeds now run only when `APP_ENV=development`; existing accounts are left unchanged. The explicit CLI seeder changes only the `admin` test account. |
| A real individual's name and username were embedded in static frontend defaults. | Fixed | Static profile defaults are now generic development values. |
| The animation library was fetched from a public CDN despite a local copy being present. | Fixed | The app now loads its existing local GSAP asset. |

## Medium-priority findings

| Finding | Status / recommendation |
|---|---|
| No CSRF token or login-attempt throttling is implemented. Session cookies use `HttpOnly` and `SameSite=Lax`, and the API does not enable cross-origin access by default, but these controls should be strengthened before public deployment. |
| `schema.sql` applies foreign-key constraints with `ALTER TABLE ... ADD CONSTRAINT`; those statements are not safe to rerun when constraints already exist. | README now warns against re-importing over a database with records. Use a reviewed, backed-up migration for schema changes. |
| The first-staff setup endpoint checks the staff count before inserting without serializing concurrent setup requests. | Add a database lock/transaction if first-run setup will be exposed beyond local development. |
| There is no automated test suite. | The `tests` directory is empty; manual smoke checks and database integration tests remain to be added. |
| The schema does not declare ISBN uniqueness. | Verify existing duplicate ISBN values and the application's ISBN rules against the live database before considering a unique index. No data or schema change was made. |

## Low-priority observations

- The reservations API is not called by the current browser frontend. It is retained as an API surface; the README now documents its supported GET and POST methods accurately.
- The project includes `backups/schema.sql.bak`, a local schema backup. It is not referenced by runtime code and was retained rather than deleted; Git ignore rules exclude it.
- No files were deleted. The bundled GSAP file is now actively used; the backup and existing project assets were preserved.
- `sql/` and `tests/` were empty at review time. `tools/` now contains the administrator seeder.

## File audit

### Changed or added

- `includes/schema_guard.php` — restrict automatic demo/admin seeds to development and read the environment safely inside the schema guard.
- `includes/dev_seed.php` — stop modifying existing `admin` accounts and source the seed password from environment configuration.
- `api/auth.php` — first-run setup creates an `admin` role.
- `tools/seed_admin.php` — add a CLI-only, repeatable seeder for the single development `admin` account.
- `index.html`, `style.css`, `script.js` — add session-aware sign-in, wire password change and logout, and remove personal profile defaults.
- `.env`, `.env.example`, `.gitignore` — configure a local-only test password, provide placeholders, and exclude local secrets and database artifacts.
- `README.md` — document setup, authentication, test seeding, safe database handling, and manual smoke checks.
- `AUDIT.md` — this findings report and recovery record.
- XAMPP local configuration — `C:\xampp\mysql\bin\my.ini` now points to the separately restored `data_rebuilt` directory; the original config is saved as `my.ini.before-library-recovery`.

### Retained

- `schema.sql` and the original `C:\xampp\mysql\data` directory were left untouched.
- `backups/schema.sql.bak` was retained as a local backup.
- All existing API modules, page assets, styles, scripts, and PHP includes were retained; no file was removed based only on lack of a direct import.

## Database and test administrator

- The checked-in schema defines `auth_users` with `username`, `password_hash`, and `role` fields; `admin` is a supported role, and staff authorization includes both `admin` and `librarian`.
- Passwords are generated with `password_hash()` and verified with `password_verify()`.
- The local `.env` is ignored by Git. The test account seed is disabled outside development.
- The original failure was a stopped MariaDB server, not an incorrect PDO driver or demonstrated bad `.env` values. Its log showed InnoDB tablespace page LSNs ahead of the system LSN and warned that the tablespace and redo logs might not match.
- A complete copy of the original data directory was made before recovery. MariaDB 10.4.32 started against that copy only with `innodb_force_recovery=1`; the `feu_library` tables were readable and exported to `C:\xampp\mysql\feu_library_recovery.sql` without `DROP TABLE` or `DROP DATABASE` statements.
- The export was restored to a separate clean copy of the XAMPP baseline. Exact pre-seed row counts matched the recovery source: `auth_users=0`, `books=0`, `id_counters=4`, `notif_prefs=1`, `reservations=0`, `settings=1`, `transactions=0`, and `users=0`.
- XAMPP's active `my.ini` now points to `C:\xampp\mysql\data_rebuilt`; the previous config is preserved at `C:\xampp\mysql\bin\my.ini.before-library-recovery`. The original data directory's `ibdata1`, `ib_logfile0`, and `ib_logfile1` SHA-256 hashes were unchanged after recovery.
- MariaDB now starts normally on port 3306 with `innodb_force_recovery=0`. The development-only first-run seed created the test administrator and demo catalog in the restored copy. Current counts are `auth_users=1`, `books=40`, `id_counters=4`, `notif_prefs=1`, `reservations=0`, `settings=1`, `transactions=18`, and `users=15`.
- `includes/schema_guard.php` also had an undefined `$APP_ENV` variable inside `ensureSchema()`. It now reads `APP_ENV` with a production-safe default; without this correction the database could connect but the API returned HTTP 500.
- Do not delete or overwrite the original data directory, the recovery copy, the SQL export, or the saved config until the restored application data has been reviewed and an independent backup is made.

## GitHub readiness

- `.gitignore` now excludes `.env`, local logs/temp files, common database exports/backups, and IDE metadata while preserving `.env.example`.
- `.env.example` contains only placeholder values.
- The README warns that the local test administrator is development-only and calls for production secrets, least-privilege DB access, and removal/change of default credentials before exposure.
- The workspace is not currently a Git repository, so tracked-file status, commit history, and accidental prior commits of secrets could not be audited. Initialize/check Git before publishing.

## Validation performed

- PHP syntax check: all 17 PHP files passed after the final schema-guard correction.
- JavaScript syntax check: `node --check script.js` passed.
- MariaDB check: the restored database starts normally on port 3306, reports `innodb_force_recovery=0`, and contains all eight expected application tables.
- API checks: `api/auth.php?action=status` returns HTTP 200; test-admin login returns HTTP 200 and the subsequent session status is authenticated with the `admin` role. The authenticated books API and logout both return HTTP 200, and the session is unauthenticated after logout. The password was read from local `.env` for the test and was not printed.
- Browser check: `http://localhost/library/` renders the staff sign-in screen without a database error.
- Still not verified: CRUD write workflows, password-change UI, reports, and dashboard totals. These should be smoke-tested before relying on the app.

## Next steps

1. Keep the original `C:\xampp\mysql\data`, recovery copy, SQL export, and saved `my.ini` until the recovered database has been reviewed and backed up independently.
2. Use the XAMPP Control Panel to manage MySQL; its `my.ini` now targets `data_rebuilt`. If startup fails, stop and inspect the new error log before changing or replacing any InnoDB files.
3. Complete the manual CRUD/report/logout/password-change smoke tests in the README.
4. Before publishing, set `APP_ENV=production`, configure a dedicated database user and secret storage, remove the development seed password from the local environment, and add automated API/database tests.