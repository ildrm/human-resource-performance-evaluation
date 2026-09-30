# Controlled improvement plans

An improvement plan is a separate formal record. It begins with a published administrative evaluation for the same employee, then records the specific gap, expected standard, source evidence, required improvement, support, measurement criteria, and dates. The plan does not change the evaluation score or trigger an employment action.

| State | Allowed next event | Actor and gate |
|---|---|---|
| Draft | Activate | Tenant or HR administrator other than the author |
| Active | Employee response | Subject employee |
| Active | Review meeting or support update | Scoped manager or HR/tenant administrator |
| Active | Decision | HR/tenant administrator other than the author, after an employee response and review meeting; requires an outcome and evidence reference |
| Decided | Appeal | Subject employee |
| Appealed | Appeal resolution | HR/tenant administrator other than the author and initial decision maker; requires an outcome and evidence reference |
| Decided | Close without appeal | HR/tenant administrator other than the author and initial decision maker; requires a recorded appeal deadline and local policy reference |

Events are append-only in PostgreSQL and are also represented in the audit chain. The initial and final outcomes remain separate. The employee can see and export a plan after activation; a draft is visible only to scoped managers and administrators. The history includes dates and actor IDs. The database allows only one open plan per employee. The web workspace exposes the same guarded steps as the API.

This is a controlled software workflow, not an approved personnel policy. An organization must define the applicable appeal period, notice and delivery procedure, representation rights, record retention, local employment rules, and who may make consequential decisions. The current close-without-appeal action records an administrator's policy reference and deadline; the system does not verify that notice was actually delivered or that the local policy is legally sufficient. Job and model validation also remains an organizational release prerequisite.
