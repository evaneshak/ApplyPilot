# Final ApplyPilot v2 migration safety review

**Reviewed file:** `docs/migrations/001_applypilot_v2.sql`.

**Verdict:** the revised migration is safe for the existing schema contract expressed by the application, subject to the production-schema and rollout limitations below. It is transactional and fails without committing partial changes when prerequisites, data, or reused objects are incompatible. No Supabase database was queried or changed during this review. No commit, push, merge, or deployment was performed. SQL tests execute only in fresh, in-memory PGlite databases.

The repository does not contain an authoritative export of the live legacy schema. This is a code/schema-contract review with actual PostgreSQL execution on fixtures, not a certification of the unseen production catalog, existing policies, or custom triggers.

## Exact migration changes

1. Added transaction-scoped migration serialization and a five-second lock wait timeout. Locked legacy `Resumes` against concurrent writes during the copy. No legacy table is truncated, dropped, renamed, or replaced.
2. Added prerequisites for the required legacy columns/types, enabled application RLS, and unique/non-null legacy resume ownership. Incompatible inputs abort instead of being coerced or discarded.
3. Added the owner-only `applypilot_migration_state` receipt. The legacy copy and initial application assignments now run **once**, atomically with the receipt. Rerunning the file preserves intentional null assignments, edited profiles, deleted profiles, activity, versions, and timestamps.
4. Added detection of an unmarked pre-existing v2 schema. An installation made with the earlier, receipt-free SQL is rejected for explicit reconciliation rather than guessing whether its null assignments or changed resume text are intentional.
5. Verified reused v2 columns, nullability, defaults, identity/ownership constraints, length constraints, indexes, and the receipt primary key. `IF NOT EXISTS` no longer silently accepts an incompatible definition.
6. Scoped foreign-key discovery to `public."Applications"`; verified the referenced table, both column orders, validation, and delete/update actions. A same-named constraint on another table cannot suppress creation of the real ownership FK.
7. Added an explicit trigger guard against a non-null `resume_id` with a null `user_id`. PostgreSQL's default composite-FK null behavior alone would otherwise skip that relationship check.
8. Added a restrictive resume-owner policy alongside the permissive owner policy, so an additional broad permissive policy cannot grant cross-user access. Revoked broad grants from `PUBLIC`, `anon`, **and `authenticated`**, then granted only SELECT/INSERT/UPDATE/DELETE. In particular, authenticated users do not retain a default `TRUNCATE` grant that bypasses row security.
9. Added `applypilot_normalize_events(jsonb)`: absent or JSON-null history becomes `[]`; one structurally valid legacy event is wrapped in an array; valid arrays retain all entries and order. Nonempty malformed history raises a predictable validation error without committing changes. It is never silently thrown away or merged as an object/scalar.
10. Added `applypilot_validate_workspace(jsonb)`: validates the root, pending note, event objects/dates, interviews/reminders and their IDs/types/dates, preparation answers, role-draft text, and stored AI-result containers/lists. Pending notes must be nonempty strings of at most 5,000 characters instead of silently truncating arbitrary JSON.
11. Made event history server-owned: INSERT produces the saved event; UPDATE uses normalized **OLD** history and appends events. Supplying an alternative valid `events` array does not replace stored history. Malformed supplied history is rejected.
12. Enforced the **500,000-byte** JSONB text limit both before processing and **after generated events are appended**, for INSERT and UPDATE. Oversized writes roll back; existing history is not trimmed to make room. Tests include the exact boundary and multibyte text.
13. Made revision numbers server-owned: INSERT initializes zero; UPDATE increments the old revision, ignoring a client-supplied counter, and rejects invalid/overflowed old values.
14. Added `applypilot_resume_timestamp()` and an UPDATE trigger. The frontend already submits `updated_at` when saving text, but RPC/default/direct API updates now also receive a database timestamp. Initial legacy timestamps are preserved because the copy precedes installation of this trigger.
15. Hardened `set_default_resume()`: explicit authenticated user, security invoker, fixed search path, per-user transaction advisory lock, and target-row `FOR UPDATE` lock **before** clearing the existing default. Missing or foreign targets fail before any default is changed. Re-selecting the current default is a no-op. Function permissions exclude anonymous callers.

## Checks against the requested scenarios

| Requirement | Result |
| --- | --- |
| Existing application/resume data | Every original column value remains unchanged by the migration. Only the new application `resume_id` is initially populated. No legacy row is deleted. |
| Legacy resume | Copied as `Primary Resume`, default=true, exact non-null text and timestamp retained. Legacy SQL null text becomes empty text in the new row only; a null timestamp receives the current time. Original row stays untouched. |
| No legacy resume | No fabricated profile; applications keep null `resume_id`. The frontend can create a first profile with default=true. |
| Multiple applications | Each initial unassigned application receives its own user's default profile. Non-null assignments are not overwritten. |
| Accidental second/third run | Receipt prevents all repeat data backfills; functions/triggers/policies are replaced transactionally without duplicate triggers; indexes/constraints are verified and reused. |
| RLS | Cross-user SELECT is hidden, INSERT/ownership changes are rejected, UPDATE/DELETE affect no foreign rows, and anonymous access is denied. An extra permissive policy does not bypass the restrictive owner guard. |
| Composite FK | Wrong-owner and nonexistent IDs are rejected; null-owner selection is rejected separately; referenced resumes cannot be deleted. |
| Malformed history | Missing/null normalized; valid single event wrapped; malformed nonempty values or members rejected without corrupting or erasing history. |
| Workspace size | Input and post-event stored sizes checked in bytes. Exactly 500,000 bytes is accepted if no generated addition pushes it over; 500,001 bytes or post-event overflow is rejected atomically. |
| Default uniqueness | Partial unique index guarantees **at most one** default per user. It does not require a default when no resumes exist or after deliberate deletion/unsetting. |
| Concurrent default requests | Same-user RPCs serialize through a transaction lock; the target-row lock prevents deletion between existence check and update. The unique index independently rejects conflicting direct writes. Errors/deadlocks abort the transaction, preserving committed data. |
| Resume timestamps | Text saves already send timestamps; the database trigger now covers every UPDATE, including default changes. |

The concurrency result above is based on PostgreSQL locking semantics and review of the SQL. PGlite uses a single connection: these tests verify transactional/default invariants but are **not** a true multi-connection concurrency stress test. Competing direct writes can legitimately receive a uniqueness/deadlock error and must retry; they cannot create two committed defaults.

## Frontend-to-schema mapping

| Frontend access | SQL contract |
| --- | --- |
| `from("resume_profiles").select("*").eq("user_id", userId).order("created_at")` | Lowercase `public.resume_profiles`; `user_id` UUID, timestamps `timestamptz`. |
| Profile insert/update | UUID `id` defaults server-side; `user_id` UUID; `title`, `text`, `notes` text; `is_default` boolean; `updated_at` timestamp. Limits match UI controls. |
| Profile delete | UUID filter; owning-user policy and application FK restriction. |
| `rpc("set_default_resume", {profile_id: id})` | Exact SQL function/parameter name `public.set_default_resume(profile_id uuid)`. |
| `from("Applications")` | Existing case-sensitive `public."Applications"` remains unchanged. No assumption is made that application IDs are UUIDs; tests use numeric IDs. |
| `source_url`, `employment_type` | Nullable text columns. Work arrangement remains encoded in the existing `location` field. |
| `resume_id` | Nullable UUID with composite owner FK. |
| `v2_data` | Non-null JSONB object; stored workspace shapes mirror `ApplicationWorkspace.jsx`, `analysis.js`, and analytics readers. |
| `v2_version` | Non-null integer, zero on creation; workspace updates use equality filtering and returned server revision. |
| `from("Resumes")` legacy editor | Existing case-sensitive table retained. Its single-user `upsert(..., {onConflict:"user_id"})` behavior is not changed. |

No frontend query names or types needed changing in this review. The stricter timestamp and JSON handling are backward-compatible with the current frontend payloads, which are exercised in SQL tests.

## Automated checks

`test/migration.test.js` adds **13 PostgreSQL-backed tests** to the normal `npm test` run. Each fixture is a new in-memory database with separate `authenticated`/`anon` roles and representative legacy tables. Tests cover preservation, repeated execution after user edits/deletions, RLS and dangerous grants, owner FK checks, timestamps/default selection, malformed JSON, valid frontend payloads, stale revisions, exact byte bounds, rollback, and schema/name collisions.

`@electric-sql/pglite` is a new **development-only** dependency; it is not imported by the application or bundled into the frontend. The old `scripts/verification/migration.mjs` entry point now runs this suite instead of maintaining a second, outdated test fixture.

Final validation: `npm run lint` passed with no warnings/errors; `npm test` passed all 30 tests (including 13 migration tests); `npm run build` passed. The existing 500 KB chunk-size advisory remains (initial JS 565.89 KB, 155.83 KB gzip). `git diff --check` passed.

## Remaining risks and production decision

- The live schema, Supabase role configuration, custom triggers, table sizes, and current application RLS were not fetched. Preconditions validate the requirements encoded in this file when you run it, but existing application policies remain your existing policies. Keep a backup and test the file against a staging copy before production cutover.
- This file deliberately aborts on an earlier unmarked v2 install, incompatible reused definitions, duplicate/null legacy ownership, oversized legacy resumes, or invalid FK data. Do not remove the guards to force it through; reconcile the specific mismatch first.
- DDL, indexes, the legacy copy, and the initial assignment update lock/scan tables. Lock acquisition times out after five seconds and safely aborts. Schedule the cutover appropriately for production traffic; the migration is not an online, lock-free operation.
- Resume copying is a one-time cutover. Old frontend clients must not keep editing the legacy `Resumes` table after v2 takes over; later legacy edits are intentionally not copied over v2 profile edits on a rerun.
- Malformed existing nonempty activity history requires explicit repair; the trigger rejects writes rather than silently losing it. Near-limit valid history also requires an intentional archival/storage change before further events can be saved.
- Normal RLS applies to authenticated users; database owners/service roles bypass it by design. No service-role credentials are added to the frontend.

**Run this one file:** `docs/migrations/001_applypilot_v2.sql`. There is no second migration file to run.

**Local startup:** Vite can technically start without the schema upgrade, but the full v2 workflows require this migration on the Supabase database referenced by `.env.local` **before using v2 locally**. Running the frontend on localhost does not create a separate database. If `.env.local` points at production, local actions still use production. Prefer a migrated staging/development Supabase project for local testing.

## PostgreSQL references

The JSON normalization handles PostgreSQL’s documented [JSONB concatenation behavior](https://www.postgresql.org/docs/current/functions-json.html). The policy design accounts for [permissive/restrictive policy composition and operations outside RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). RPC serialization uses [transaction advisory locks and row locks](https://www.postgresql.org/docs/current/explicit-locking.html).
