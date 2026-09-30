# Review discussion

Each evaluation has an append-only discussion thread with an explicit visibility channel. `SHARED` messages are visible to the employee and authorized review staff after publication. `INTERNAL` messages are visible only to authorized review staff. An employee's self-service data copy includes shared messages for published evaluations and excludes internal messages. The API checks employee, manager, role, and tenant scope for every read and write; auditors have read-only access.

Internal discussion begins after manager submission. Shared discussion begins after publication. The calibration topic is internal only, and the appeal topic becomes available after an appeal. Message text is bounded to 3,000 characters; the audit event records the message reference and channel without copying the text into the outbox. Message rows reject updates and deletes in PostgreSQL.

This is a review and appeal discussion record, not a general chat system. It has no scheduling, delivery receipts, reminders, external messages, notification preferences, moderation, or policy-specific notice clock. Organizations must define who is authorized to discuss sensitive matters and which communications count as formal notice before consequential use.
