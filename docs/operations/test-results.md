# Verification record

## 30 September 2026 local implementation run

This run used a rebuilt Compose stack with PostgreSQL 18.6 and migrations through 023. It verifies a local synthetic path; it is not production acceptance evidence.

| Gate | Result |
|---|---|
| Format, lint, strict typecheck | Passed |
| Calculation and API tests | 34 passed: 21 engine and 13 API/integration |
| Production and Docker builds | Passed; web, API, worker, and PostgreSQL containers started |
| Dependency audit | `pnpm audit --prod --audit-level high`: no known vulnerabilities |
| Local HTTP smoke | Passed model governance, period scoring, evidence, administrative approval, publication, independent appeal resolution, replay, tenant denial, CSV agreement, and existing workflow checks |
| Browser tests | Seven passed in headless Chrome after selecting the employee created by the same synthetic fixture run |
| Browser security headers | Login response returned a request nonce in `script-src` and `style-src`, plus frame, content-type, referrer, and permissions headers |
| Restore and service objectives | Not rerun; 15-minute RPO, four-hour RTO, and 99.9% availability are not verified |

The first browser attempt selected an older fixture employee whose password had been replaced by a newer smoke run. The runner now passes a unique fixture suffix to both the HTTP and browser suites; all seven browser tests passed on rerun. The live HTTP suite also exposed an obsolete appeal-resolution payload, which was updated to the structured outcome and remedy contract.

## Earlier local baseline

Run on 28–29 September 2026 in a local Windows workspace. Local Node was 24.18.0; the container image is pinned to Node 24.21.0 LTS. Database image: PostgreSQL 18.6.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm format:check` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | 30 passed: 18 calculation, 12 API/integration |
| `pnpm test:e2e` | Seven passed in headless Chrome: workspace navigation including trends, review conflict and discussion panels, and download, binary-proportion metric and counted evidence authoring, dated organization unit and assignment authoring, goal/development/context authoring, 390-pixel viewport width, improvement-plan, governance-case and context employee history, keyboard login |
| `pnpm build` | Passed: NestJS and Next.js production builds |
| `pnpm audit --json` | Zero advisories at run time |
| `docker compose up --build -d` | Passed with the final source and lockfile after transient Docker Hub TLS and package-download retries; fresh web, API, and PostgreSQL stack passed smoke and browser tests |
| Migration first and repeat run | Passed through migration 018 with PostgreSQL 18.6 |
| Review-actor migration and repeat run | Passed against existing PostgreSQL 18.6 data; backfilled prior actors |
| API readiness | HTTP 200 with database connected |
| HTTP smoke | Passed: model setup → evidence → score → calibration → publish → acknowledge → appeal → replay → CSV; BARS, feedback, goals/check-ins, development actions, improvement plans and independent appeal resolution, safety-case, unreviewed-context, and review-conflict publication holds, shared/internal review discussion, purpose-separated longitudinal results, self-data copy, administrative dossier gate, and session revocation |
| Independent review gate | Same-actor calibration and publication rejected; separate calibrator and publisher succeeded in embedded PostgreSQL and HTTP smoke |
| Session revocation | Embedded PostgreSQL role-change and revocation test passed; HTTP smoke revoked one session and every session for a user |
| Login throttling | Embedded PostgreSQL window/identity isolation and live HTTP 401→429 checks passed; stale counters have hourly cleanup |
| Evidence Quality Index | Pure component tests and embedded PostgreSQL independent activation, calculation, replay, and prospective-policy change passed |
| Audit integrity | Embedded PostgreSQL detects event-content tampering, flags unverifiable legacy payloads, and rejects updates to audit and selected history tables after migration 013 |
| Behavior and 360 feedback | Embedded PostgreSQL checks independent scale approval, invited responses, threshold suppression, and exclusion of self ratings from the weighted result |
| Goals, development and data copy | Embedded PostgreSQL checks prospective revisions, purpose separation, action history, role scope, self-service export, and exclusion of password hashes |
| Improvement plans | Embedded PostgreSQL and HTTP checks published administrative source, employee response, review meeting, independent activation/decision/appeal review, append-only event history, draft privacy, and export |
| Safety and compliance cases | Embedded PostgreSQL and HTTP checks independent triage/finding/resolution, employee response, administrative publication hold and release, and employee export |
| Context and opportunity | Embedded PostgreSQL and HTTP checks optional paired exposure values, independent verification, administrative publication hold, canonical evaluation detail, and employee export |
| Longitudinal scores | Pure tests for available and insufficient descriptive trends and malformed input; embedded and HTTP tests separate development and administrative series; headless browser navigation and employee history passed |
| Binary proportion uncertainty | Pure Wilson boundary and sample-strength tests; embedded PostgreSQL rejects inconsistent/fractional counts and saves the interval in the canonical result without changing its score; headless browser enters a proportion metric and counted evidence |
| Organization history | Embedded PostgreSQL rejects overlapping unit versions and primary assignments, isolates tenants, preserves a calculated review's organization snapshot after reassignment, and includes assignments/events in self export; headless browser creates a dated unit and assignment |
| Review conflicts | Embedded PostgreSQL and live HTTP checks unresolved publication/calibration holds, separate resolver, replacement eligibility, recusal of the declarer, and replacement calibration after reassignment; browser panel appears in review detail |
| Review discussion | Embedded PostgreSQL and HTTP checks shared/internal visibility, employee denial for internal posting, cross-tenant denial, append-only message trigger, and shared-only self export; browser panel appears in review detail |
| Telemetry | Identifier and route-template sanitization tests pass; HTTP smoke now checks that a personal-text correlation header is replaced and W3C trace context survives the web proxy |
| Administrative model dossier | Embedded PostgreSQL and HTTP checks reject publication without a current independently reviewed dossier; retirement blocks later publication |
| Cross-tenant HTTP access | Returned 404 for another tenant's evaluation |
| Embedded PostgreSQL RLS test | Passed read and write isolation for a non-owner role |
| Runtime row-security guard | API readiness returned HTTP 200 with the non-owner application role; PostgreSQL reported `row_security_active('users') = false` for the migration owner, which the startup check rejects |
| Backup and restore | Local PostgreSQL 18.6 custom-format backup restored after migration 018; source and restore matched at 2 tenants, 41 evaluations, 1,386 audit events, 2 review conflicts, 2 review messages, and 18 migrations; non-owner role replayed all 41 evaluations and 34 evidence-quality results without mismatch |

An earlier smoke attempt immediately after Compose startup met a web startup race; the script now waits for the login route. The in-app Browser connection failed to initialize, so headless Chrome with Playwright was used for the browser tests. Desktop and mobile screenshots were captured and inspected; a mobile horizontal-overflow defect was fixed. The test suite checks keyboard login, but no screen-reader or full WCAG audit was performed. The HTTP smoke remains API testing through the Next.js proxy. Load, penetration, SAST, production-scale recovery, and jurisdiction-specific scientific/legal validation are not complete.
