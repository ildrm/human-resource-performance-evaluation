# Organization history

Administrators can create dated units for organization, subsidiary, legal entity, country, region, site, division, business unit, department, team, cost center, and project team. A child unit's effective period must fit within its parent period. Versions of the same unit code cannot overlap. Units are created as records; this workflow does not yet support an audited restructure or end-date correction for a unit.

HR or tenant administrators can assign an employee to a unit as **primary** or **matrix** for a dated period. Only one primary assignment can be active at a time; matrix assignments can coexist. Assignment creation and shortening are audited, and a separate append-only event records each action. The employee, their manager, HR, calibrators, and auditors can inspect assignment history within their normal access scope.

When a review is calculated, the server saves the assignments active on the cycle end date in `org_snapshot`. It includes the unit and parent identity. A subsequent assignment change does not silently rewrite a calculated or published review; a draft recalculation explicitly takes a new snapshot. Older reviews created before migration 016 have an empty snapshot. The snapshot is descriptive context and does not change the score.

The organization model is still partial. It does not implement position/grade history, a complete legal-entity hierarchy policy, audited unit reorganization, retroactive correction approval, or jurisdiction rules. Administrators must check dated organizational records before consequential use.
