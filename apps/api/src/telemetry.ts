import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

type TraceContext = { correlationId: string; traceId: string; spanId: string };
const context = new AsyncLocalStorage<TraceContext>();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const traceparent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function safeCorrelationId(
  value: string | string[] | undefined,
): string {
  return typeof value === "string" && uuid.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

export function safeTraceId(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    const match = traceparent.exec(value);
    if (match && !/^0+$/.test(match[1]!) && !/^0+$/.test(match[2]!))
      return match[1]!;
  }
  return randomBytes(16).toString("hex");
}

export function routeTemplate(path: unknown): string {
  return typeof path === "string" &&
    path.length <= 160 &&
    /^\/[A-Za-z0-9_/:.-]*$/.test(path)
    ? path
    : "unmatched";
}

export function requestTelemetry(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const correlationId = safeCorrelationId(request.headers["x-correlation-id"]);
  const traceId = safeTraceId(request.headers.traceparent);
  const spanId = randomBytes(8).toString("hex");
  const started = performance.now();
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Correlation-ID", correlationId);
  response.setHeader("traceparent", `00-${traceId}-${spanId}-01`);
  response.once("finish", () => {
    console.info(
      JSON.stringify({
        event: "http_request",
        at: new Date().toISOString(),
        correlationId,
        traceId,
        spanId,
        method: request.method,
        route: routeTemplate(request.route?.path),
        statusClass: `${Math.floor(response.statusCode / 100)}xx`,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
  });
  context.run({ correlationId, traceId, spanId }, next);
}

export function logTimedOperation(
  operation: "evaluation_calculation" | "evaluation_report",
  started: number,
  outcome: string,
  count?: number,
): void {
  const trace = context.getStore();
  console.info(
    JSON.stringify({
      event: operation,
      at: new Date().toISOString(),
      correlationId: trace?.correlationId ?? null,
      traceId: trace?.traceId ?? null,
      spanId: trace?.spanId ?? null,
      outcome,
      ...(count === undefined ? {} : { count }),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    }),
  );
}
