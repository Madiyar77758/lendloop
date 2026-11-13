import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { canonicalInbound, sign } from "../convex/lib/hmac";
import { AUTOMATION_SECRET, addDays, as, configureEnv, flush, setup, today, type T } from "./helpers";

let t: T;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  configureEnv();
  t = setup();
});
afterEach(async () => {
  await flush(t);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Calls the Convex HTTP API the way the n8n workflows do. */
async function signedCall(method: "GET" | "POST", path: string, body = "", opts: { secret?: string; timestamp?: string; signPath?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = await sign(opts.secret ?? AUTOMATION_SECRET, canonicalInbound(timestamp, method, opts.signPath ?? path, body));
  return t.fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
    body: method === "POST" ? body : undefined,
  });
}

async function overdueLoan() {
  const olga = as(t, "olga", "Olga");
  const ben = as(t, "ben", "Ben");
  await olga.mutation(api.users.store, {});
  await ben.mutation(api.users.store, {});
  const toolId = await olga.mutation(api.tools.create, { name: "Ladder", category: "hand tools", condition: "fair", description: "3 m" });
  const loanId = await ben.mutation(api.loans.request, { toolId, startDate: addDays(today(), 1), endDate: addDays(today(), 2) });
  await olga.mutation(api.loans.decide, { loanId, decision: "approve" });
  await t.run(async (ctx) => ctx.db.patch(loanId, { startDate: addDays(today(), -10), endDate: addDays(today(), -4) }));
  return { loanId };
}

describe("n8n -> Convex authentication", () => {
  it("rejects unsigned requests", async () => {
    const res = await t.fetch("/automation/overdue-loans", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const res = await signedCall("GET", "/automation/overdue-loans", "", { secret: "not-the-secret" });
    expect(res.status).toBe(401);
  });

  it("rejects stale timestamps (replay protection)", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await signedCall("GET", "/automation/overdue-loans", "", { timestamp: old });
    expect(res.status).toBe(401);
  });

  it("rejects a signature captured from a different endpoint", async () => {
    const res = await signedCall("GET", "/automation/overdue-loans", "", { signPath: "/automation/errors" });
    expect(res.status).toBe(401);
  });

  it("rejects a body that was changed after signing", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(AUTOMATION_SECRET, canonicalInbound(timestamp, "POST", "/automation/errors", '{"workflow":"a","executionId":"1"}'));
    const res = await t.fetch("/automation/errors", {
      method: "POST",
      headers: { "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
      body: '{"workflow":"b","executionId":"1"}',
    });
    expect(res.status).toBe(401);
  });

  it("fails closed when the secret is not configured", async () => {
    delete process.env.AUTOMATION_API_SECRET;
    const res = await signedCall("GET", "/automation/overdue-loans");
    expect(res.status).toBe(503);
  });
});

describe("GET /automation/overdue-loans", () => {
  it("returns only approved loans past their due date, with minimal fields", async () => {
    const { loanId } = await overdueLoan();
    const res = await signedCall("GET", "/automation/overdue-loans");
    expect(res.status).toBe(200);
    const { loans } = await res.json();
    expect(loans).toEqual([{ loanId, toolName: "Ladder", borrowerName: "Ben", dueDate: addDays(today(), -4), daysOverdue: 4, lastReminderAt: null }]);
  });

  it("includes the borrower email only when NOTIFY_INCLUDE_EMAIL=true", async () => {
    await overdueLoan();
    process.env.NOTIFY_INCLUDE_EMAIL = "true";
    const { loans } = await (await signedCall("GET", "/automation/overdue-loans")).json();
    expect(loans[0].borrowerEmail).toBe("ben@example.com");
  });

  it("does not list returned loans", async () => {
    const { loanId } = await overdueLoan();
    await as(t, "olga", "Olga").mutation(api.loans.markReturned, { loanId });
    const { loans } = await (await signedCall("GET", "/automation/overdue-loans")).json();
    expect(loans).toEqual([]);
  });
});

describe("POST /automation/reminders (idempotent write-back)", () => {
  it("stores one reminder per idempotency key, however many times n8n retries", async () => {
    const { loanId } = await overdueLoan();
    const body = JSON.stringify({ loanId, idempotencyKey: `${loanId}:${today()}`, channel: "email", status: "sent" });

    const first = await (await signedCall("POST", "/automation/reminders", body)).json();
    const second = await (await signedCall("POST", "/automation/reminders", body)).json();
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(second).toEqual({ ok: true, duplicate: true });

    const rows = await t.run(async (ctx) => ctx.db.query("reminders").collect());
    expect(rows).toHaveLength(1);
  });

  it("a new day produces a new reminder, and the admin view shows when it was sent", async () => {
    const { loanId } = await overdueLoan();
    for (const day of [addDays(today(), -1), today()]) {
      const body = JSON.stringify({ loanId, idempotencyKey: `${loanId}:${day}`, channel: "email", status: "sent" });
      await signedCall("POST", "/automation/reminders", body);
    }
    expect(await t.run(async (ctx) => ctx.db.query("reminders").collect())).toHaveLength(2);

    const root = as(t, "root", "Root");
    await root.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "root@example.com")).first();
      if (user) await ctx.db.patch(user._id, { role: "admin" });
    });
    const [row] = await root.query(api.loans.adminAll, {});
    expect(typeof row.lastReminderAt).toBe("number");
  });

  it("rejects malformed payloads without writing anything", async () => {
    const { loanId } = await overdueLoan();
    for (const body of [
      "not json",
      JSON.stringify({ loanId: "nope", idempotencyKey: "k", channel: "email", status: "sent" }),
      JSON.stringify({ loanId, idempotencyKey: "k", channel: "email", status: "maybe" }),
      JSON.stringify({ loanId, channel: "email", status: "sent" }),
    ]) {
      const res = await signedCall("POST", "/automation/reminders", body);
      expect(res.status).toBe(400);
    }
    expect(await t.run(async (ctx) => ctx.db.query("reminders").collect())).toHaveLength(0);
  });
});

describe("POST /automation/errors", () => {
  it("logs a failed n8n execution once", async () => {
    const body = JSON.stringify({ workflow: "loan-events", executionId: "42", message: "SMTP timeout" });
    await signedCall("POST", "/automation/errors", body);
    await signedCall("POST", "/automation/errors", body);
    const rows = await t.run(async (ctx) => ctx.db.query("automationLog").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "error", status: "failed", detail: "loan-events: SMTP timeout" });
  });

  it("requires workflow and executionId", async () => {
    const res = await signedCall("POST", "/automation/errors", JSON.stringify({ message: "x" }));
    expect(res.status).toBe(400);
  });
});
