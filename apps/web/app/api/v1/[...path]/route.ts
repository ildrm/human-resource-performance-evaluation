import { NextRequest, NextResponse } from "next/server";

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const target = new URL(
    `/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    base,
  );
  const headers = new Headers();
  for (const key of [
    "cookie",
    "origin",
    "content-type",
    "x-correlation-id",
    "traceparent",
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const maxRequestBytes = 10 * 1024 * 1024;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maxRequestBytes)
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let uploaded = 0;
  let exceeded = false;
  const body =
    ["GET", "HEAD"].includes(request.method) || !request.body
      ? null
      : request.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              uploaded += chunk.byteLength;
              if (uploaded > maxRequestBytes) {
                exceeded = true;
                controller.error(new Error("Request too large"));
                return;
              }
              controller.enqueue(chunk);
            },
          }),
        );
  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      ...(body === null ? {} : { body, duplex: "half" }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    } as RequestInit & { duplex?: "half" });
  } catch {
    return NextResponse.json(
      { error: exceeded ? "Request too large" : "Upstream unavailable" },
      { status: exceeded ? 413 : 504 },
    );
  }
  const outgoing = new Headers();
  for (const key of [
    "content-type",
    "set-cookie",
    "cache-control",
    "x-correlation-id",
    "traceparent",
    "content-disposition",
  ]) {
    const value = response.headers.get(key);
    if (value) outgoing.set(key, value);
  }
  return new NextResponse(response.body, {
    status: response.status,
    headers: outgoing,
  });
}
export const GET = proxy;
export const POST = proxy;
