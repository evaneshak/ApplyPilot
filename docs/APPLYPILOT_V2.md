# ApplyPilot v2 implementation report

The existing application now uses a light workspace with a persistent desktop sidebar, compact mobile navigation, deep teal accents, yellow primary actions, and neutral cards. The supplied reference informed the palette, spacing, and hierarchy; no competitor assets, copy, or branding were used. ApplyPilot remains the product name. No marketing landing page was added.

## Implemented

| Area | Result |
| --- | --- |
| Overview | Real application metrics, pipeline, recent applications, upcoming deadlines, interviews, reminders, and follow-up suggestions |
| Applications | Table/board toggle; retained search, status/location/deadline filters, sorting, edit, delete confirmation, duplicate checks, and status controls |
| Add Job | Authenticated server-side URL import, manual paste fallback, Gemini normalization, editable review, resume selection, source URL and employment type |
| Resumes | Named profiles, text/PDF editing, notes, duplication, default selection, application assignment, deletion protection, and bulk recalculation using each application’s resume |
| Match | Stored overall score, supported subscores, strengths, evidence-qualified gaps, reasoning, next action, and explicit recalculation |
| Tailoring | Original/suggested/why cards, copy/accept/dismiss, exact-source-quote validation, separate role draft; master resume is not overwritten |
| Interviews | Multiple rounds, date/time, type, interviewer, location/meeting link, notes, editing, completion, cancellation, deletion, and prep access |
| Preparation | Posting/resume-grounded priorities, themes, technical topics, STAR prompts, questions, concerns, and saved answers; explicitly not live research |
| Activity | Atomic status/match/resume/deadline events, interview/reminder events, and manual notes |
| Reminders | In-app create/edit/complete/snooze/delete; follow-up suggestions only when a recorded submission event supports the date |
| Insights | Weekly/monthly activity, response/interview/offer/rejection rates, snapshot conversion ratios, match average, company/location/employment distributions, match-band outcomes, and recorded stage intervals |
| Accessibility | Semantic controls, focus indicators, labeled inputs, modal focus containment/restoration, Escape dismissal, reduced motion, and responsive tables |

Existing Supabase authentication, confirmation-link signup, session persistence, password reset, Gemini retries, PDF extraction, assistant boundaries, and legacy application fields remain in place. PDF.js now loads only when importing a PDF, reducing the initial JavaScript bundle substantially.

## Files

New files:

- `src/features/Workspace.jsx`: overview, insights, shared table and heading.
- `src/features/theme.css`: light visual system and responsive layouts.
- `src/features/analytics.js`: data-derived metrics and stage durations.
- `src/features/analysis.js`: AI task prompts, schema checks, upcoming/follow-up logic.
- `src/features/ApplicationWorkspace.jsx`: application tabs and persisted workflows.
- `src/features/ResumeLibrary.jsx`: resume library, editor and selector.
- `src/features/useResumeProfiles.js`: authenticated profile persistence.
- `api/import-job.js`, `api/_lib/jobImport.js`, `api/_lib/importAuth.js`: authenticated, bounded server-side ingestion.
- `docs/migrations/001_applypilot_v2.sql`: additive schema/data upgrade.
- `test/v2.test.js`: new unit coverage.
- `scripts/verification/browser.mjs`: isolated browser checks with synthetic API fixtures and real PDF extraction.
- `scripts/verification/migration.mjs`: temporary PostgreSQL migration/RLS checks.
- `docs/screenshots/v2-overview-desktop.png` and `v2-overview-mobile.png`: verified UI captures with synthetic test data.
- This report.

Modified files: `src/App.jsx`, `src/index.css`, `src/pdfText.js`, `api/_lib/helpChat.js`, `server/server.js`, `index.html`, and `README.md`.

## Database upgrade and deployment

**The migration has been tested locally but has not been applied to the live Supabase project. Production has not been deployed.**

Exact migration order:

1. Review and run `docs/migrations/001_applypilot_v2.sql` against staging, then the production project during the v2 cutover.
2. Deploy the frontend and serverless handlers together using the existing Vercel workflow.
3. Complete the real-account smoke checklist below.

There is only one migration. Take the normal database backup/snapshot before deployment. The actual production schema was not accessible in this session; the migration uses the `Applications` and `Resumes` names and columns already referenced by the existing client. It fails transactionally if prerequisite tables or enabled application RLS are absent. Check production policies and any additional constraints before running it.

The migration creates `resume_profiles`, copies each existing single resume into a default **Primary Resume**, and links existing applications to it. It adds `source_url`, `employment_type`, `resume_id`, `v2_data`, and `v2_version` to `Applications`. It does not drop or rename existing tables/columns, reset accounts, or remove legacy resumes, match data, reasons, deadlines, or applications.

Interviews, reminders, preparation, role drafts, and activity are stored as structured JSON within their owning application row. They inherit the existing application RLS and `user_id`, avoiding duplicate ownership rules across several new child tables. Version-checked writes reject stale workspace updates. A database trigger appends activity atomically. A composite foreign key ensures a selected resume belongs to the same user and blocks deletion while referenced. Resume default changes use a transaction with a per-user lock.

The legacy single-resume editor remains a fallback if profiles cannot load. New workflow storage requires the migration; run it before deploying. Legacy resume rows are retained for rollback, but v2 profile edits are not mirrored back into the old single-resume table. Do not run a long-lived mixed-version rollout in which old and new clients both edit resumes. The reviewed migration records the initial copy in an owner-only receipt. Reruns preserve intentional null assignments, profile edits/deletions, and timestamps. See [the final safety review](MIGRATION_SAFETY_REVIEW.md) for schema guards and rollout limitations.

Workspace JSON is limited to 500 KB per application. Resume text is limited to 100,000 characters. Oversized existing resumes cause a safe migration rollback rather than truncation. Archive/normalization would be appropriate if a future version needs very large application histories.

## Packages and environment

The migration safety review adds `@electric-sql/pglite` as a development-only dependency for PostgreSQL-backed tests in `npm test`. No runtime dependencies were added. Playwright/Chromium and Prettier were temporary verification tools.

No new environment-variable names are required. The URL-import handler uses the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` server-side to verify the supplied bearer token through Supabase. The local Express server additionally reads the root `.env.local`. Existing `GEMINI_API_KEY`, `VITE_APP_URL`, and local `PORT` behavior remain unchanged. No service-role key is used.

## URL import behavior and security

Only public HTTP/HTTPS postings are supported. The importer rejects credentials, custom ports, internal/special hostnames, private/reserved IPv4 addresses, alternate loopback encodings, unsupported protocols, and IPv6. IPv6-only sites intentionally fall back to manual paste.

DNS answers are checked before connection, and the connection is pinned to a validated IPv4 address via Node’s lookup callback, preventing a second DNS resolution from redirecting the request internally. Every redirect is revalidated; at most three redirects are followed. The entire retrieval has a 10-second deadline, a 1.5 MB response limit, a 16 KB header limit, HTML content-type validation, and identity encoding. Authentication verification has its own five-second timeout. No private page contents or bearer tokens are logged.

JSON-LD `JobPosting` data is preferred, including nested graphs; malformed structured data falls back to main/article/body text. Scripts, styles, navigation, and markup are removed. Extracted text is bounded to 60,000 characters, passed to the existing Gemini flow, and reviewed before saving. Imported HTML is never rendered with `dangerouslySetInnerHTML`.

Blocked sites, login walls, JavaScript-only postings, unsupported encodings, anti-bot systems, oversized pages, and unavailable URLs return a useful manual-paste fallback. The importer does not bypass protected sites. Source text and AI output remain untrusted. AI schemas are checked before display, and the help assistant receives only help messages, not resume/application content.

Implementation references: [Node HTTP request options](https://nodejs.org/api/http.html#httprequesturl-options-callback) and [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Validation

- `npm run lint`: passed, zero errors or warnings.
- `npm test`: passed, **30 tests**, zero failures (17 existing v2/reliability tests + 13 migration safety tests).
- `npm run build`: passed. Initial JS approximately **565.89 KB / 155.83 KB gzip**; PDF parsing is a separate on-demand chunk. Vite’s existing advisory for chunks above 500 KB remains.
- Browser checks: all five workspace views at **1440, 1024, 768, 430, and 390 px**; no horizontal body overflow or JavaScript exceptions. Verified board/detail navigation, Escape dismissal, reminder saving, interview completion, generated analysis, tailoring acceptance, saved prep answers, notes, and imported-job review/save with isolated mock services. Real PDF extraction is included in the verification script.
- Temporary PostgreSQL checks: legacy preservation, migration rerun, user isolation, cross-owner resume rejection, attached-resume deletion protection, default selection, atomic timeline writes, and stale-version rejection passed.

Unit coverage includes SSRF/URL validation, DNS rejection and pin selection, structured extraction/fallback, safe endpoint errors, analytics edge cases, reminders/snooze, match schemas, exact tailoring source quotes, follow-up evidence, stage intervals, and all existing Gemini reliability tests.

These checks do **not** claim live Supabase/Gemini/Vercel end-to-end verification. They use local code, a temporary PostgreSQL engine, and mocked browser service responses. Production auth delivery, live URL retrieval, actual Gemini wording quality, Safari, and production database policies still require the smoke checks below. Grounding prompts and exact-source checks reduce fabrication risk; users must review generated wording before using a role draft.

The migration suite runs through `npm test` using the development dependency. The optional browser verification script requires externally installed `playwright`. Set `APPLYPILOT_QA_MODULES` to the directory containing that tool installation’s `node_modules`, or install them locally for development. Browser verification expects Vite at `http://127.0.0.1:5173` and reads only the Supabase URL from `.env.local`; it intercepts service calls and uses a separate synthetic session. `APPLYPILOT_QA_OUTPUT` can select a screenshot directory. The scripts never modify the production database.

## Tradeoffs

- Board status changes use the existing accessible application-detail buttons. Drag-and-drop was not added; mobile and keyboard users share the reliable persisted workflow.
- Analytics explicitly label current-status ratios as snapshots, not historical funnel measurements. Stage timing uses only complete recorded transitions; legacy history is not fabricated.
- Interview dates are entered and displayed in the browser’s local timezone, stored as UTC instants with timezone metadata. No independent timezone-picker conversion is attempted.
- Reminders are in-app only. There are no emails, push notifications, calendar invitations, employer messages, or automatic applications.
- Tailoring acceptance creates a separate saved role draft, with copy/export as text. It never overwrites a master resume.

## Real-account manual smoke checklist

- [ ] **Auth:** signup, confirmation email, login, invalid-login feedback, logout, password reset, session persistence; repeat in Safari.
- [ ] **Overview:** verify totals against real applications, recent ordering, deadlines, upcoming interviews/reminders, and follow-up suggestions.
- [ ] **Applications:** search, status/location/deadline filters, sorting, table, board, open/edit/delete, status updates, duplicate review, empty results.
- [ ] **Add Job:** public URL, blocked/invalid URL fallback, manual paste, parsing failure, editable review, source URL, skills, employment type, resume selection, save and reload.
- [ ] **Resumes:** legacy Primary Resume migration, create, rename, edit, PDF import including scanned/oversized failure, duplicate, default, assignment, blocked attached deletion, bulk recalculation.
- [ ] **Match:** overall and subscores, strengths, qualified gaps, reasoning, recalculation, failed-AI feedback, and resume-change notice.
- [ ] **Tailoring:** original text quotes, factual review of suggestions, accept/copy/dismiss, separate role draft, unchanged master resume.
- [ ] **Interviews:** add/edit rounds, date/time, interviewer and meeting link, complete/cancel/delete, preparation link, upcoming display.
- [ ] **Reminders:** add/edit/complete/snooze/delete, overdue display, suppression of redundant suggested follow-ups.
- [ ] **Prep:** generate posting-grounded prompts, enter answers, save, reopen, verify no claim of live company research.
- [ ] **Timeline:** status, match, resume, deadline, interview, reminder, and manual-note events; test a stale second-tab workspace edit.
- [ ] **Insights:** zero/one/many applications, missing scores/dates, snapshot denominators, employment/company/location grouping, recorded stage durations.
- [ ] **AI Help:** usage guidance, normal failure handling, refusal of external actions and hidden-prompt requests.
- [ ] **Responsive:** desktop/tablet/mobile, table scrolling, board scrolling, forms, modal focus and Escape, touch targets, assistant placement.
- [ ] **Persistence:** refresh, sign out/in, verify every new record; second account must not see or attach first account data.
- [ ] **Production:** Vercel build, all serverless routes, server-side import authentication, live Gemini parsing/recalculation, existing RLS policies, and a real public posting.
