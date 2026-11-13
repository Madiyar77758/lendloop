import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { canonicalOutbound, verify } from "../convex/lib/hmac";
import { N8N_SECRET, addDays, as, configureEnv, flush, setup, today, type T } from "./helpers";

let t: T;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  configureEnv();
  t = setup();
});
afterEach(async () => {
  await flush(t);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function requestLoan() {
  const olga = as(t, "olga", "Olga");
  const ben = as(t, "ben", "Ben");
  await olga.mutation(api.users.store, {});
  await ben.mutation(api.users.store, {});
  const toolId = await olga.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power tools",
    condition: "worn",
    description: "private notes: gate code 1234",
  });
  const loanId = await ben.mutation(api.loans.request, { toolId, startDate: addDays(today(), 1), endDate: addDays(today(), 3) });
  return { olga, ben, toolId, loanId };
}

const logs = () => t.run(async (ctx) => ctx.db.query("automationLog").collect());

describe("outbound webhook to n8n", () => {
  it("sends a signed, minimal payload to the lender when a loan is requested", async () => {
    const { loanId } = await requestLoan();
    await flush(t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://n8n.test/webhook/loan-events");

    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(await verify(N8N_SECRET, canonicalOutbound(headers["x-lendloop-timestamp"], body), headers["x-lendloop-signature"])).toBe(true);
    expect(headers["x-lendloop-event-id"]).toBe(`${loanId}:loan.requested`);

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      eventId: `${loanId}:loan.requested`,
      event: "loan.requested",
      loan: { id: loanId, toolName: "Cordless drill", status: "requested" },
      recipient: { role: "owner", displayName: "Olga" },
    });
    // Data minimization: nothing beyond what a notification needs.
    expect(body).not.toContain("gate code");
    expect(body).not.toContain("olga@example.com");
    expect(body).not.toContain("tokenIdentifier");
    expect(payload.recipient.email).toBeUndefined();
  });

  it("includes the recipient email only when explicitly enabled", async () => {
    process.env.NOTIFY_INCLUDE_EMAIL = "true";
    await requestLoan();
    await flush(t);
    const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.recipient.email).toBe("olga@example.com");
  });

  it("notifies the borrower when the lender decides", async () => {
    const { olga, loanId } = await requestLoan();
    await flush(t);
    await olga.mutation(api.loans.decide, { loanId, decision: "approve" });
    await flush(t);
    const payloads = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(payloads.map((p) => [p.event, p.recipient.role, p.recipient.displayName])).toEqual([
      ["loan.requested", "owner", "Olga"],
      ["loan.approved", "borrower", "Ben"],
    ]);
  });

  it("retries with backoff after a failure and records every attempt", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED")).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await requestLoan();
    await flush(t);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const entries = (await logs()).filter((l) => l.kind === "webhook").sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));
    expect(entries.map((e) => [e.attempt, e.status])).toEqual([[1, "retrying"], [2, "ok"]]);
    expect(entries[0].detail).toContain("ECONNREFUSED");
  });

  it("treats a non-2xx answer as a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 })).mockResolvedValue(new Response("ok", { status: 200 }));
    await requestLoan();
    await flush(t);
    const entries = (await logs()).filter((l) => l.kind === "webhook");
    expect(entries.some((e) => e.status === "retrying" && e.detail.includes("HTTP 500"))).toBe(true);
    expect(entries.some((e) => e.status === "ok")).toBe(true);
  });

  it("gives up after 5 attempts and leaves a visible 'failed' record", async () => {
    fetchMock.mockRejectedValue(new Error("n8n is down"));
    await requestLoan();
    await flush(t);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const entries = (await logs()).filter((l) => l.kind === "webhook");
    expect(entries.filter((e) => e.status === "retrying")).toHaveLength(4);
    expect(entries.filter((e) => e.status === "failed")).toEqual([expect.objectContaining({ attempt: 5 })]);
  });

  it("records a clear failure when the webhook is not configured, instead of crashing", async () => {
    delete process.env.N8N_WEBHOOK_URL;
    await requestLoan();
    await flush(t);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await logs())[0]).toMatchObject({ status: "failed" });
  });

  it("a rejected mutation sends no notification", async () => {
    const { ben, toolId } = await requestLoan();
    await flush(t);
    fetchMock.mockClear();
    await expect(ben.mutation(api.loans.request, { toolId, startDate: addDays(today(), 2), endDate: addDays(today(), 4) })).rejects.toBeTruthy();
    await flush(t);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
