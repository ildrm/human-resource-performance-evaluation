# Human Performance Intelligence

An **early, runnable foundation** for role-specific performance evaluation. It is **not production-ready** and has not been scientifically validated for employment decisions.

## Implemented path

1. Bootstrap an organization and administrator.
2. Define a job, metric, versioned target, role template, employee, and cycle.
3. Submit and verify evidence.
4. Calculate an evaluation with explicit missing-data handling and a score trace.
5. Submit a manager assessment, record a calibration decision, publish, acknowledge, and appeal.
6. Replay the saved calculation snapshot and inspect the evaluation register.
7. Define job-specific behavioral anchors and collect closed-campaign feedback with minimum respondent thresholds; feedback stays separate from the authoritative score.
8. Configure an independently approved, versioned [Evidence Quality Index](docs/scientific/evidence-quality.md) policy and replay its saved trace alongside the performance score.
9. Set development or administrative goals, preserve prospective revisions, and record employee/manager check-ins.
10. Create development actions with a capability gap, activity, optional training and mentor, progress, manager review, and evidenced completion. Development actions cannot be attached to administrative cycles.
11. Run a documented [improvement plan](docs/workflows/improvement-plans.md) from a published administrative evaluation, with independent HR activation, employee response, review meetings, a reasoned decision, and an independent appeal review. The plan does not automate an employment action.
12. Record [safety and compliance cases](docs/workflows/governance-cases.md) with independent triage and findings, employee response, and a publication hold while a case is triaged or confirmed.
13. Document [context and opportunity](docs/workflows/context.md), including optional expected and actual exposure, independent review, and a hold on administrative publication while context remains unreviewed.
14. Download a scoped, audited copy of your own profile, evidence, published evaluations, decisions, goals, development actions, activated improvement plans, triaged cases, and context records.
15. Record an independently reviewed [model evidence dossier](docs/scientific/model-governance.md) before an administrative evaluation can be published.
16. Inspect [longitudinal results](docs/scientific/longitudinal.md) from published evaluations, grouped by the same role template and review purpose. Descriptive statistics appear only when the observation rule is met.
17. Define binary proportion measures with explicit success and trial counts. The saved score trace shows a [Wilson uncertainty interval](docs/scientific/proportion-uncertainty.md) for the observed percentage, separate from the policy score.
18. Maintain [effective-dated organization units and assignments](docs/workflows/organization-history.md), including matrix roles, a single primary role per period, and the organization snapshot attached to a calculated review.
19. Disclose and independently resolve [review conflicts](docs/workflows/review-conflicts.md), with an administrative publication hold and a named replacement for the affected review stage.
20. Record [review discussion](docs/workflows/review-discussion.md) in separate employee-shared and internal channels, including review, calibration, and appeal topics.
21. Approve role templates through separate review, validation, and approval steps before activation, with rationale and limitations recorded.
22. Calculate with effective-dated targets for each observation, an approved period aggregation rule, explicit missing-weight policy, and a saved engine/input provenance trace. Existing version-one results retain their legacy replay path.
23. Resolve evaluation appeals through an independent reviewer with a structured outcome, employee notice, and append-only score amendment when warranted. The original published score remains visible.
24. Page the evaluation register and stream CSV output from frozen employee snapshots and canonical results. In-app appeal notices are delivered by a leased outbox worker.

Scores are organization-configured policy results. The software does not supply a universal employee ranking, validated benchmark, or automatic employment decision.

## Run locally

Requirements: Node 24, pnpm 11.25, PostgreSQL 18, or Docker Compose. Copy `.env.example` to `.env` and set secrets. See [deployment instructions](docs/operations/deployment.md). From the repository root:

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

For direct local execution, set the variables in `apps/api/.env.example` in your shell. `db:migrate` and `db:seed` need the migration owner URL. The app needs a separate non-owner `DATABASE_URL` role so PostgreSQL row-level policies apply.

Web: `http://localhost:3000` · API: `http://localhost:4000` · OpenAPI: `http://localhost:4000/docs`

## Structure

- `apps/web`: Next.js workspace and same-origin API proxy.
- `apps/api`: NestJS API, migration, bootstrap command, tenant-aware persistence.
- `packages/contracts`: shared input validation and types.
- `packages/calculation-engine`: pure decimal normalization and aggregation.
- `docs`: architecture, calculation interpretation, security, deployment, and traceability.

## Verification and limits

The current local gates pass: lint, strict typecheck, 34 calculation/API tests, seven headless Chrome browser tests, production and Docker builds, dependency audit, PostgreSQL 18 migrations through 023, and a real HTTP smoke workflow. A small local backup restore was previously verified through migration 018; production recovery has not been tested. Full accessibility, penetration, load, production recovery, and scientific/legal validation checks are still required. See [test evidence](docs/operations/test-results.md), the [requirements matrix](docs/requirements-matrix.md), and the [production release gates](docs/operations/release-gates.md). Do not use this build for consequential personnel decisions.
