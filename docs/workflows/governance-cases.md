# Safety and compliance case governance

Severe ethics, fraud, regulatory, safety, and security events use a separate case workflow. A report is an allegation, not a finding. It has an event date, factual description, evidence reference, reporter, and append-only events. The case does not alter a calculated score or make an employment decision.

| State | Next event | Gate |
|---|---|---|
| Reported | Triage | HR or tenant administrator other than the reporter |
| Triaged | Employee response | Subject employee |
| Triaged | Confirm | HR or tenant administrator other than the reporter and triage actor; employee response, evidence, and policy basis required |
| Triaged | Reject | HR or tenant administrator other than the reporter and triage actor; evidence and policy basis required |
| Confirmed | Resolve | HR or tenant administrator other than the reporter and finding actor; remediation evidence and policy basis required |

The employee sees a case after triage. A triaged or confirmed case holds publication of that employee's administrative evaluations. The publication check and case transitions serialize on the employee database row, so the hold and publication have a defined order under concurrency. Rejection or resolution removes the hold. Existing published evaluations are not silently changed. The case and its events appear in the employee's self-service copy after triage.

This workflow does not establish that an alleged event occurred, that evidence is reliable, or that any policy or employment action is legally appropriate. The organization must define its investigation, notice, representation, evidence, appeal, retention, and remediation rules for each jurisdiction before consequential use. The current workflow has no separate appeal of a case finding and no external incident intake or notification channel.
