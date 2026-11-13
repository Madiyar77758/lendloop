import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { addDays, as, configureEnv, flush, promote, setup, today, type T } from "./helpers";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

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

async function scene() {
  const olga = as(t, "olga", "Olga");
  const ben = as(t, "ben", "Ben");
  const cara = as(t, "cara", "Cara");
  const root = as(t, "root", "Root");
  for (const u of [olga, ben, cara, root]) await u.mutation(api.users.store, {});
  await promote(t, "root@example.com");
  const toolId = await olga.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power tools",
    condition: "good",
    description: "18V",
  });
  return { olga, ben, cara, root, toolId };
}

const d = (n: number) => addDays(today(), n);

describe("requesting a loan", () => {
  it("creates a pending request visible to both sides, and to nobody else", async () => {
    const { olga, ben, cara, toolId } = await scene();
    await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    expect(await ben.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await olga.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await cara.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await cara.query(api.loans.incoming, {})).toHaveLength(0);
  });

  it("rejects bad input", async () => {
    const { olga, ben, toolId } = await scene();
    await expect(olga.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(2) })).rejects.toEqual(code("INVALID")); // own tool
    await expect(ben.mutation(api.loans.request, { toolId, startDate: "2026-13-40", endDate: d(2) })).rejects.toEqual(code("INVALID"));
    await expect(ben.mutation(api.loans.request, { toolId, startDate: "tomorrow", endDate: d(2) })).rejects.toEqual(code("INVALID"));
    await expect(ben.mutation(api.loans.request, { toolId, startDate: d(-1), endDate: d(2) })).rejects.toEqual(code("INVALID")); // past
    await expect(ben.mutation(api.loans.request, { toolId, startDate: d(5), endDate: d(4) })).rejects.toEqual(code("INVALID")); // end < start
    await expect(ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(40) })).rejects.toEqual(code("INVALID")); // too long
  });

  it("allows a single-day loan and a 30-day loan, but not 31 days", async () => {
    const { ben, toolId } = await scene();
    await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(1) });
    await ben.mutation(api.loans.request, { toolId, startDate: d(10), endDate: d(39) });
    await expect(ben.mutation(api.loans.request, { toolId, startDate: d(50), endDate: d(80) })).rejects.toEqual(code("INVALID"));
  });

  it("blocks a duplicate open request by the same borrower for overlapping dates", async () => {
    const { ben, toolId } = await scene();
    await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(5) });
    await expect(ben.mutation(api.loans.request, { toolId, startDate: d(4), endDate: d(8) })).rejects.toEqual(code("CONFLICT"));
    await ben.mutation(api.loans.request, { toolId, startDate: d(6), endDate: d(8) }); // not overlapping: fine
  });
});

describe("overlap protection", () => {
  it("refuses new requests that overlap an approved loan", async () => {
    const { olga, ben, cara, toolId } = await scene();
    const first = await ben.mutation(api.loans.request, { toolId, startDate: d(2), endDate: d(6) });
    await olga.mutation(api.loans.decide, { loanId: first, decision: "approve" });
    await expect(cara.mutation(api.loans.request, { toolId, startDate: d(6), endDate: d(9) })).rejects.toEqual(code("CONFLICT"));
    await cara.mutation(api.loans.request, { toolId, startDate: d(7), endDate: d(9) });
  });

  it("two pending requests can coexist, but only one can be approved", async () => {
    const { olga, ben, cara, toolId } = await scene();
    const a = await ben.mutation(api.loans.request, { toolId, startDate: d(2), endDate: d(6) });
    const b = await cara.mutation(api.loans.request, { toolId, startDate: d(4), endDate: d(8) });
    await olga.mutation(api.loans.decide, { loanId: a, decision: "approve" });
    await expect(olga.mutation(api.loans.decide, { loanId: b, decision: "approve" })).rejects.toEqual(code("CONFLICT"));
    await olga.mutation(api.loans.decide, { loanId: b, decision: "decline" });
  });

  it("a returned or declined loan frees the dates again", async () => {
    const { olga, ben, cara, toolId } = await scene();
    const a = await ben.mutation(api.loans.request, { toolId, startDate: d(0), endDate: d(3) });
    await olga.mutation(api.loans.decide, { loanId: a, decision: "approve" });
    await olga.mutation(api.loans.markReturned, { loanId: a });
    const b = await cara.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(2) });
    await olga.mutation(api.loans.decide, { loanId: b, decision: "approve" });
  });
});

describe("who may act on a request", () => {
  it("only the owner approves, declines or marks returned; not the borrower, a stranger or an admin", async () => {
    const { olga, ben, cara, root, toolId } = await scene();
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });

    for (const who of [ben, cara, root]) {
      await expect(who.mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toEqual(code("FORBIDDEN"));
    }
    await olga.mutation(api.loans.decide, { loanId, decision: "approve" });
    for (const who of [ben, cara, root]) {
      await expect(who.mutation(api.loans.markReturned, { loanId })).rejects.toEqual(code("FORBIDDEN"));
    }
    await olga.mutation(api.loans.markReturned, { loanId });
  });

  it("a request can be decided only once", async () => {
    const { olga, ben, toolId } = await scene();
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    await olga.mutation(api.loans.decide, { loanId, decision: "decline" });
    await expect(olga.mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toEqual(code("CONFLICT"));
  });

  it("only approved loans can be returned", async () => {
    const { olga, ben, toolId } = await scene();
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    await expect(olga.mutation(api.loans.markReturned, { loanId })).rejects.toEqual(code("CONFLICT"));
  });

  it("the borrower can cancel a pending request, nobody else can, and not after approval", async () => {
    const { olga, ben, cara, toolId } = await scene();
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    await expect(cara.mutation(api.loans.cancel, { loanId })).rejects.toEqual(code("FORBIDDEN"));
    await expect(olga.mutation(api.loans.cancel, { loanId })).rejects.toEqual(code("FORBIDDEN"));
    await ben.mutation(api.loans.cancel, { loanId });
    expect((await ben.query(api.loans.myRequests, {}))[0].status).toBe("cancelled");

    const second = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    await olga.mutation(api.loans.decide, { loanId: second, decision: "approve" });
    await expect(ben.mutation(api.loans.cancel, { loanId: second })).rejects.toEqual(code("CONFLICT"));
  });

  it("the admin overview lists all loans and flags overdue ones", async () => {
    const { olga, ben, root, toolId } = await scene();
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: d(1), endDate: d(3) });
    await olga.mutation(api.loans.decide, { loanId, decision: "approve" });
    await t.run(async (ctx) => ctx.db.patch(loanId, { startDate: d(-10), endDate: d(-3) }));
    const [row] = await root.query(api.loans.adminAll, {});
    expect(row.overdue).toBe(true);
    expect(row.borrowerName).toBe("Ben");
  });
});
