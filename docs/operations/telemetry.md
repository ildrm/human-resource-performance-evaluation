# Request telemetry

The API emits JSON lines for completed HTTP requests and timed calculation/report operations. Each line includes a generated or validated correlation ID, W3C trace ID, span ID, route **template**, status class, and elapsed milliseconds. The Next.js proxy forwards `traceparent` and returns both trace and correlation headers. Caller-supplied correlation IDs are accepted only as UUIDs; other text is replaced. A trace parent must use the supported W3C format and nonzero IDs.

The request log omits raw URLs, query strings, employee IDs, tenant IDs, request and response bodies, cookies, and evidence text. Operation logs include only a bounded operation name, status, row count where relevant, timing, and trace identifiers. These logs can be collected and aggregated by an operations system without exposing HR data as labels. Keep access to the logs restricted.

This is a partial observability foundation. It does not yet install an OpenTelemetry SDK or collector, export metrics, trace background outbox delivery, define service-level objectives, or test production alerting. The process logger and platform logs must be configured and reviewed before deployment.
