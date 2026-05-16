/**
 * CSRF guard for state-mutating routes. Modeled after the existing
 * Origin === Host check in app/api/kiosk/checkin/route.ts.
 *
 * Usage in a route handler:
 *   const csrf = checkOrigin(req);
 *   if (!csrf.ok) return Response.json({ error: csrf.error }, { status: 403 });
 */
export function checkOrigin(req: Request): { ok: true } | { ok: false; error: string } {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) {
    // Same-origin form submits sometimes omit Origin (esp. GET). Mutating
    // endpoints should always see Origin from fetch() / XHR. Reject when missing.
    return { ok: false, error: "Origin header missing — request rejected" };
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      return { ok: false, error: `Origin mismatch: ${originHost} != ${host}` };
    }
  } catch {
    return { ok: false, error: "Origin header malformed" };
  }
  return { ok: true };
}
