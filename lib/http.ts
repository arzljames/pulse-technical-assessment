// Request-body helpers for route handlers (S6).

export type JsonResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

// Reads a JSON object body of at most `maxBytes`. Oversized bodies are
// refused from Content-Length before anything is read, and re-checked after
// (chunked bodies have no Content-Length). Accepts text/plain too, because
// navigator.sendBeacon sends strings that way.
export async function readJson(request: Request, maxBytes: number): Promise<JsonResult> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return { ok: false, response: tooLarge() };

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: invalid() };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, response: tooLarge() };
  }

  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { ok: false, response: invalid() };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: invalid() };
  }
}

function invalid(): Response {
  return Response.json({ error: "invalid body" }, { status: 400 });
}

function tooLarge(): Response {
  return Response.json({ error: "body too large" }, { status: 413 });
}
