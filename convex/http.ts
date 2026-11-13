import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { canonicalInbound, isTimestampFresh, verify } from "./lib/hmac";

const http = httpRouter();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Every n8n -> Convex request must carry a fresh timestamp and an HMAC over
 * `${timestamp}.${METHOD}.${path}.${rawBody}` (secret: AUTOMATION_API_SECRET).
 * Binding method and path stops a captured signature from being replayed
 * against a different endpoint.
 */
async function authorize(req: Request, rawBody: string): Promise<Response | null> {
  const secret = process.env.AUTOMATION_API_SECRET;
  if (!secret) return json(503, { error: "automation_api_not_configured" });

  const timestamp = req.headers.get("x-lendloop-timestamp");
  if (!isTimestampFresh(timestamp)) return json(401, { error: "missing_or_stale_timestamp" });

  const path = new URL(req.url).pathname;
  const ok = await verify(secret, canonicalInbound(timestamp!, req.method, path, rawBody), req.headers.get("x-lendloop-signature"));
  return ok ? null : json(401, { error: "bad_signature" });
}

http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const denied = await authorize(req, "");
    if (denied) return denied;
    const loans = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: "/automation/reminders",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    const denied = await authorize(req, raw);
    if (denied) return denied;

    let input: { loanId?: string; idempotencyKey?: string; channel?: string; status?: string };
    try {
      input = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    try {
      const result = await ctx.runMutation(internal.automation.recordReminder, {
        loanId: input.loanId as never,
        idempotencyKey: input.idempotencyKey as string,
        channel: input.channel as string,
        status: input.status as "sent" | "failed",
      });
      return json(result.ok ? 200 : 422, result);
    } catch {
      // Argument validation failed (bad id, wrong types, ...).
      return json(400, { error: "invalid_payload" });
    }
  }),
});

http.route({
  path: "/automation/errors",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    const denied = await authorize(req, raw);
    if (denied) return denied;

    let input: { workflow?: string; executionId?: string; message?: string };
    try {
      input = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (!input.workflow || !input.executionId) return json(400, { error: "invalid_payload" });

    const result = await ctx.runMutation(internal.automation.recordError, {
      eventId: `n8n:${input.workflow}:${input.executionId}`.slice(0, 160),
      detail: `${input.workflow}: ${input.message ?? "no message"}`,
    });
    return json(200, result);
  }),
});

export default http;
