# Implementation Progress

Last updated: 2026-10-04 (Stage 5 applied). Status legend: DONE (verified) / DRAFTED (written, not yet verified) / OPEN.

## Stage status

| Stage | Status |
|---|---|
| 0 Audit completion | DONE (static review of provided files; see findings) |
| 1 Security/environment | CODE DONE, user steps pending (see Stage 1) |
| 2 Transactions | CODE DONE; verified on MariaDB 10.11 via API tests, UI not browser-tested |
| 3 Real data | CODE DONE; frontend smoke-tested in jsdom; PHP/SQL changes NOT executed yet (run `tests/stage3_api_test.py`) |
| 4 Correctness | OPEN |
| 5 DB/migrations | DONE (applied to live DB after rehearsal on a restored copy; see Stage 5) |
| 6 Accessibility/UI | OPEN |
| 7 Cleanup | OPEN |
| 8 Tests/docs | OPEN |

## Stage 0 — new findings and corrections to AUDIT.md

Corrections
- AUDIT "Critical: none" is wrong: no `.htaccess` exists, so `.env`, `schema.sql`, `README.md`, `AUDIT.md`, `includes/` are web-served under XAMPP. `.env` holds a weak, shared dev password.
- LIKE wildcard escaping is already correct in `books.php`/`users.php` (`likeTerm()` + `ESCAPE`).
- Server already computes fines on return and ignores client fine/title/name fields. Grace period and max renewals are enforced server-side; the UI has no renew control.
- DB "preserved records" are dev seed only; original DB had 0 application rows.

Confirmed bugs (file: issue)
- `script.js`: `refreshUsers()` calls `users.php` with no limit, server default is 25 → only 25 patrons load (issue/return wizards break for others; `findUser()` undefined crash in return confirm). Books capped at 100, transactions at 50.
- `script.js`: `isoDaysAgo()/isoDaysFromNow()` use `toISOString()` (UTC) → wrong date 00:00–08:00 Manila.
- `script.js`: `renderReports` uses fake `ACTIVITY_SERIES`/`MOST_BORROWED`; `api/reports.php` is never called.
- `script.js`: settings reset overwrites the real admin account (username/email/display name) with defaults; server already has `action:"reset"` for settings only.
- `script.js`: `saveBookForm` saves fabricated description, cycled format, guessed cover URL.
- `script.js`: `CATEGORIES` (8) vs server `BOOK_CATEGORIES` (12): editing a Computer Science/Math/Education/Social Sciences book silently recategorizes to Literature. `PROGRAMS` list likewise rewrites seed patrons' programs on edit.
- `script.js`: Borrow/Reserve/Save mock actions mutate local state only; hardcoded fake notification items; inert footer/Help; invented library hours in Services.
- `script.js`: `updateReturnCalc`/overdue report read the unsaved `#settings-fine-rate` input and ignore grace period (server uses grace).
- `script.js`: `applyTheme` re-renders reports to "borrowing" (resets overdue tab).
- `script.js`: top-level `gsap.defaults()` throws if gsap fails to load → login and app both dead.
- `script.js`: `api()` has no 401 handling; password meter says 8 chars, rule is 10.
- `style.css`: closed mobile menubar only translated off-screen (still focusable); GSAP ignores `prefers-reduced-motion`; `--ink-muted` ≈3.0:1 and `--brass` text ≈2.1:1 on paper (estimates; verify with a checker).
- `api/transactions.php`: issue/return dates are client-supplied; no check that return ≥ issue date or ≤ today; issue date can be backdated/future.
- `api/auth.php` / `includes/auth.php`: no login throttling; role/status cached in session for 8h (deactivation not enforced mid-session); first-run `setup` check not serialized.
- `api/reports.php`: "finesCollected" is fines assessed; no payment tracking exists.
- `api/account.php`: `avatarPreset` unvalidated (>50 chars → SQL error).
- `includes/schema_guard.php`: ~15 schema/information_schema queries and counter upserts on every request.
- `includes/bootstrap.php`: error handler converts all notices/deprecations to exceptions (fragile on newer PHP).
- Missing indexes: `transactions(issue_date)`, `(return_date)`, `(return_date, due_date)`.
- Do NOT delete `.dash-*`, `.overdue-*`, `.rank-*`, `.shelf-bar*`, `.panel-frontdesk` CSS in Stage 7: needed for the operational dashboard (Stage 3).

## Stage 1 — security and environment
Verified by user: `.htaccess` (their edited version is the one delivered) returns 403 for `.env`, `schema.sql`, `README.md`, `includes/bootstrap.php`, `tools/seed_admin.php`.
Code changes (PHP 8.3 syntax-checked; `tests/stage1_auth_test.php` 20/20 pass with stubs + in-memory SQLite; NOT yet run on XAMPP/MySQL):
- `includes/auth.php`: `requireAuth()` re-checks role/status in DB each request (deactivation/demotion immediate, 401 + logout); `session.gc_maxlifetime` set to 8h (PHP default ~24 min expired sessions early); file-based login throttle (5 fails/15 min per ip+username, 30 per ip, 429 + `Retry-After`); `assertSameOrigin()` blocks cross-site POST/PUT/DELETE.
- `api/auth.php`: throttled login with constant-time unknown-user check; password-change throttled; setup serialized with `GET_LOCK`; passwords capped at 72 chars (bcrypt); `status` revalidates against DB.
- `includes/bootstrap.php`: unknown `APP_ENV` → production; production refuses `root`/empty `DB_PASS`; notices/deprecations are logged instead of thrown.
- `includes/dev_seed.php` / `schema_guard.php`: dev admin password must be ≥12 chars and not contain admin/password/12345; a failed seed is logged, not a 500 on every request.
User steps pending: rotate `DEV_ADMIN_PASSWORD` (the old one is now rejected by the seeder; existing `admin` hash is unchanged until `php tools/seed_admin.php`); create least-privilege DB user; confirm login/throttle behavior in the browser.
Known gaps: throttle store is the PHP temp dir (fine for single XAMPP host); no CSP on `index.html` yet (needs inline-script hash, Stage 6); frontend 401 redirect is Stage 4; README still says 10-char dev password (Stage 8).

## Stage 2 — transaction integrity
Stage 1 confirmed by user in the browser.
Changes:
- `api/transactions.php`: all POST types staff-only. Issue date is always server today (Asia/Manila); due date defaults to today + loan_days and must be between today and today + loan_days. Return date defaults to today, must be valid, not in the future, not before the issue date. Fine always computed server-side; client fine/status/title/name fields ignored. Row locks always book -> patron (no deadlocks); patron row lock makes the loan-limit check race-safe. State conflicts return 409, validation 422. Overdue loans cannot be renewed (previously renewing wiped the fine). Lock-wait/deadlock errors return a friendly 409.
- `includes/domain.php`: added `addDaysIso()`.
- `script.js`: Manila-based date helpers (replaces UTC `toISOString` today/due logic); issue date read-only; due date input bounded; issue/return send only IDs + dates; double-click guard; return uses the server's fine; return preview uses the saved fine rate; return flow no longer crashes when the patron is not in the loaded list.
Verification (`tests/stage2_transactions_test.py`, real MariaDB 10.11 + PHP 8.3 server, 8 workers): 43/43 pass, including 10 parallel issues of one book (1 wins), 10 parallel issues to one patron vs limit 5 (exactly 5), 10 parallel returns (1 wins), forged fine/dates, invalid dates, wrong patron, renew limits, and SQL invariants (no double open loans, no Available book with an open loan, no over-limit patron). Run against the original `transactions.php` the same suite had 22 failures (e.g. due date in 2099 accepted, future return date accepted, overdue renewal accepted). Frontend date helper: 8/8 in four browser timezones. `node --check script.js` OK.
Not verified: browser UI flows; server clock around Manila midnight; XAMPP's MariaDB 10.4.32 (tested on 10.11); ISBN/other Stage 3+ items.
Open: no DB-level unique guard for open loans (row locks only; needs Stage 5 approval); reservations are not enforced at issue time; no renew button in UI; patron list still capped at 25 (Stage 4).

## Stage 3 — real data and functionality
Changes:
- `api/reports.php`: (dashboard consumer removed; fields kept for reports/future use) added `collection` (titles/available/onLoan/overdue/activePatrons), `dueToday` (+`totals.dueTodayCount`); `finesCollected` renamed `finesAssessed` (no payment tracking exists, so "collected" was wrong).
- `api/books.php` + `includes/domain.php`: list returns `borrowCount` (real count from `transactions`); cover must be empty or a valid http(s) URL (422 otherwise).
- `index.html`: **revised after review:** Discover is the original editorial homepage again (hero, featured collection, photo, services, statement, footer) — the operational dashboard was removed at the owner's request; its data still lives in Reports. Only invented facts changed: the "Library hours" card is now "Visit us" (address/phone/email from saved settings), Borrowing text and footer Visit column also read saved settings, and Featured shows real catalog titles (empty-state text if none). Fake notification items, Help item, profile "password" field, Language select removed; prototype/localStorage claims in Settings and Reports ("Demo data") corrected; 4 missing category pills added; Borrow/Reserve/Save buttons replaced by "Issue this book" (opens the Issue wizard with the book preselected).
- `script.js`: both reports now read `api/reports.php` (loading/error+retry/empty states); removed `ACTIVITY_SERIES`, `MOST_BORROWED`, `BOOK_SEED`, `BOOK_BLURBS`, `STUDENT_SEED`, `COVER_OVERRIDES`, saved/reserved mock state; "Most popular" sort uses `borrowCount`; book form saves only entered values (description, format, cover now real optional fields; no cycled format/guessed cover/generated blurb); `CATEGORIES` now matches the server's 12; patron edit no longer rewrites unknown program/year (shows current value or "Not specified"); settings reset now calls `settings.php {action:"reset"}` and no longer touches the admin account; notifications menu reads `api/notifs.php`; password meter threshold 10; report type survives theme switch; null guards for year/ISBN/category/borrower.
- `style.css`: removed the rule that hid the notification button; homepage full-bleed margins kept; dark-mode badge colors fixed (Returned/Available labels were invisible: text and background were both #123A25, contrast 1.0:1; now ≥6.4:1).
Verification: `node --check script.js` OK; jsdom smoke (mocked API): homepage hero/featured/settings-driven text, hero search routing, borrowing-report badge labels, notification dot/items, overdue report, theme switch keeps report, collection + popular sort, book details (overdue borrower, null year), Issue preselect, book edit PUT body (no fabricated fields), patron edit keeps "Not specified", settings reset makes 1 settings call and 0 account writes, no JS errors.
NOT verified: PHP syntax/queries (no PHP/MySQL in the review sandbox), real browser rendering/layout of the new dashboard, `tests/stage3_api_test.py` (written, not run).
Open / deferred: no Renew control in UI (Max renewals setting only enforced by API); `api/reservations.php` is a patron-facing API with no UI (kept, documented in Stage 8); patron/book lists still capped by API limits (Stage 4); `.explore-*` and unused dashboard CSS (`.dash-hero`, `.shelf-bar*`, `.rank-*`, `.overdue-*`) to review in Stage 7; Reservations and Digital resources service cards are original marketing copy, not backed by UI (decide in Stage 6); loader tagline "There is always something worth discovering" and Collection hero copy are still public-style (Stage 6 copy pass); `reports.php` `recent` returns 20 rows, dashboard shows 6.

## Stage 5 — database architecture and migrations
Approved and applied by the owner after a backup (`backups/feu_library_pre_stage5.sql`, git-ignored) and a rehearsal on a restored copy.
Changes:
- `tools/migrate.php` (new, CLI-only): `--dry-run` (read-only report, incl. duplicate ISBNs and stale loans), `--yes` (apply; refuses without it). Set `DB_NAME` in the environment to target a copy. Progress is recorded in `schema_migrations`.
- `includes/migrations.php` (new): repeatable steps, each with a preflight that blocks (without changing data) on bad data. 001 baseline (old `ensureSchema` body), 002 missing foreign keys, 003 indexes (`transactions.issue_date`, `.return_date`, `(type, return_date, due_date)`, non-unique `books.isbn`), 004 CHECK constraints (fine/renewals >= 0, settings minimums), 005 `transactions.open_book_id` virtual column + unique `uk_tx_open_book` (DB-level one open loan per book).
- `includes/schema_guard.php`: `ensureSchema()` replaced by `ensureBaselineSchema()` (migrate tool only) and `ensureDevSeeds()` (dev only, no DDL).
- `config.php`: requests no longer create/alter schema or reseed counters; one `schema_migrations` lookup, 503 with instructions if migrations are pending; dev seeds only when `APP_ENV=development`.
- `api/transactions.php`: duplicate-key on `uk_tx_open_book` returns 409.
- `schema.sql`: header/comments only (import, then run `tools/migrate.php --yes`).
Decisions: stored `Overdue` status left as is (already derived from `due_date` everywhere); ISBN index is non-unique (rows are physical copies; no duplicates existed).
Verification: sandbox MariaDB 10.11 + PHP 8.3 (fresh import, repeat run no-op, guard/CHECK rejections, blocked-data case with rows intact, normal request = 0 DDL statements); owner's MariaDB 10.4.32: live dry-run clean, rehearsal on restored copy applied 5/5 and re-ran as no-op, then applied to live; owner reports login, issue/return and reports working afterwards.
Not verified: `tests/stage2_transactions_test.py` and `tests/stage3_api_test.py` not confirmed run after migration; MySQL 8 not tested; HTTP-level 409 for the duplicate-key path only tested as a PDO error.
Open: README still describes the old setup flow (Stage 8); a production migration user needs ALTER rights while the app user should not (run migrate with separate credentials); `DB_PORT` 3306 vs 3307 mismatch in README/AUDIT; scratch DB `feu_library_migtest` to drop.

## Dependency map
- Auth/session: `api/auth.php` → `includes/auth.php`, `includes/bootstrap.php`, `config.php`; UI: login form + `api()` in `script.js`.
- Circulation: `api/transactions.php` → `includes/domain.php` (fines, ids, mappers), `settings` row; UI: issue/return wizards.
- Catalog/patrons: `api/books.php`, `api/users.php` → `validation.php`, `domain.php`.
- Reports/notifications: `api/reports.php`, `api/notifs.php` (UI currently unused).
- Startup: `config.php` → `bootstrap.php` + `migrations.php` (version gate) → (dev) `ensureDevSeeds` → `dev_seed.php`; CLI `tools/migrate.php`, `tools/seed_admin.php`.

## Not inspected (not provided)
`.env.example`, `js/vendor/gsap.min.js`, `backups/`, `tests/`, live Apache/MySQL behavior.

## Pending approvals / user actions
- Rotate `DEV_ADMIN_PASSWORD`; create least-privilege MySQL user; confirm `.htaccess` returns 403 (see Stage 1 verification).
- Product rule: server-authoritative issue date (= today) and bounded due date?

## Changed files
- `.htaccess` (new)
- `includes/auth.php`, `includes/bootstrap.php`, `includes/dev_seed.php`, `includes/schema_guard.php`, `api/auth.php` (modified)
- `tests/stage1_auth_test.php` (new)
- `api/transactions.php`, `includes/domain.php`, `script.js` (modified, Stage 2); `tests/stage2_transactions_test.py` (new)
- `api/reports.php`, `api/books.php`, `includes/domain.php`, `index.html`, `style.css`, `script.js` (modified, Stage 3); `tests/stage3_api_test.py` (new)
- `tools/migrate.php`, `includes/migrations.php` (new); `config.php`, `includes/schema_guard.php`, `api/transactions.php`, `schema.sql` (modified, Stage 5)
- `IMPLEMENTATION_PROGRESS.md` (new)
