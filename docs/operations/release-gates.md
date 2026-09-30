# Production release gates

Status on 30 September 2026. Passing local development checks is evidence for the implemented paths only. No tenant is approved for consequential personnel decisions.

| Workstream | Current evidence | Required before production activation |
|---|---|---|
| A. Baseline and boundaries | Strict typecheck, lint, build, CI workflow, migration checksum check for new migrations | Atomic register for every original subrequirement, module boundary enforcement, API contract coverage, upgrade rehearsal from supported prior releases |
| B. Organization and scoring | Effective-dated organization rows; version-two period scoring, target provenance, explicit missing-weight policy, template approval | Job analysis and competency framework, complete model applicability, evidence source controls, independent numeric reference, frozen executable engine artifacts |
| C. Identity and privacy | Tenant RLS, login throttling, self export, scoped roles, audit chain | OIDC and SAML broker, MFA/step-up, contextual and field permissions, retention and legal hold, protected attributes, external audit anchor, ASVS evidence |
| D. Personnel workflows | Evaluation, appeal amendment and in-app notice, development and improvement workflows, safety case | Crisis lifecycle, well-being separation, career and succession, broader coaching/notification workflow, jurisdiction policy review |
| E. Scientific validation | Model evidence dossier gate, separate uncertainty and evidence quality trace | Representative empirical studies, approved analysis plans, fairness review, independent R calculations, method suitability, named scientific approval |
| F. Integrations and reports | Leased in-app outbox worker, cursor-paged register, streamed CSV | Standards imports, signed webhooks, SMTP, S3 attachments, reproducible asynchronous XLSX/PDF jobs, scoped optional AI and tenant approval gate |
| G. English/Persian UX | Responsive English workspace and seven Chrome journeys | Persian catalogs and RTL, WCAG 2.2 AA manual checks, complete actor-specific journeys, translated exports, four demonstration organizations |
| H. Production operations | Local Compose stack, health endpoints, migration checks, local restore through migration 018 | Helm deployment, HA PostgreSQL/WAL/PITR, 15-minute RPO and four-hour RTO drills, 99.9% availability evidence, observability, load and security testing |

The original request calls for twelve review passes and named HR/SME, scientific, privacy/legal, security, accessibility, and operations approvals. None can be inferred from synthetic fixtures or passing code tests. See [verification record](test-results.md) and [requirements matrix](../requirements-matrix.md).
