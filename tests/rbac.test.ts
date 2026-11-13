import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { promoteToAdmin } from "../convex/users";
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

async function people() {
  const olga = as(t, "olga", "Olga");
  const ben = as(t, "ben", "Ben");
  const root = as(t, "root", "Root");
  await olga.mutation(api.users.store, {});
  await ben.mutation(api.users.store, {});
  await root.mutation(api.users.store, {});
  await promote(t, "root@example.com");
  return { olga, ben, root };
}

const drill = { name: "Cordless drill", category: "power tools", condition: "good", description: "18V, two batteries" } as const;

describe("authentication and roles", () => {
  it("every new profile is a plain user, even if the client tries to say otherwise", async () => {
    const { olga } = await people();
    const me = await olga.query(api.users.me, {});
    expect(me?.role).toBe("user");
    expect(me?.trustedLender).toBe(false);
  });

  it("promoteToAdmin is internal: there is no public way to become admin", () => {
    const fn = promoteToAdmin as unknown as { isPublic?: boolean; isInternal?: boolean };
    expect(fn.isInternal).toBe(true);
    expect(fn.isPublic).not.toBe(true);
  });

  it("signed-out visitors only get the public feed", async () => {
    const { olga } = await people();
    await olga.mutation(api.tools.create, drill);

    const anon = t;
    await expect(anon.query(api.tools.list, {})).rejects.toEqual(code("UNAUTHENTICATED"));
    await expect(anon.query(api.loans.incoming, {})).rejects.toEqual(code("UNAUTHENTICATED"));
    await expect(anon.mutation(api.tools.create, drill)).rejects.toEqual(code("UNAUTHENTICATED"));

    const feed = await anon.query(api.tools.listPublic, {});
    expect(feed).toEqual([{ name: "Cordless drill", category: "power tools" }]);
  });

  it("admin-only queries and mutations reject regular users and accept admins", async () => {
    const { olga, ben, root } = await people();
    await olga.mutation(api.tools.create, drill);
    const olgaId = (await olga.query(api.users.me, {}))!._id;

    await expect(ben.query(api.loans.adminAll, {})).rejects.toEqual(code("FORBIDDEN"));
    await expect(ben.query(api.users.listLenders, {})).rejects.toEqual(code("FORBIDDEN"));
    await expect(ben.mutation(api.users.setTrustedLender, { userId: olgaId, trusted: true })).rejects.toEqual(code("FORBIDDEN"));
    // The lender cannot make themselves trusted either.
    await expect(olga.mutation(api.users.setTrustedLender, { userId: olgaId, trusted: true })).rejects.toEqual(code("FORBIDDEN"));

    await root.mutation(api.users.setTrustedLender, { userId: olgaId, trusted: true });
    const lenders = await root.query(api.users.listLenders, {});
    expect(lenders).toEqual([expect.objectContaining({ displayName: "Olga", trustedLender: true, toolCount: 1 })]);
    expect(await root.query(api.loans.adminAll, {})).toEqual([]);
  });

  it("the trusted flag shows up on listings", async () => {
    const { olga, ben, root } = await people();
    await olga.mutation(api.tools.create, drill);
    const olgaId = (await olga.query(api.users.me, {}))!._id;
    await root.mutation(api.users.setTrustedLender, { userId: olgaId, trusted: true });
    const [row] = await ben.query(api.tools.list, {});
    expect(row.ownerTrusted).toBe(true);
    expect(row.ownerName).toBe("Olga");
  });
});

describe("listing ownership", () => {
  it("only the owner edits a listing; admins cannot edit others' listings", async () => {
    const { olga, ben, root } = await people();
    const toolId = await olga.mutation(api.tools.create, drill);
    const edit = { toolId, ...drill, name: "Hijacked" };
    await expect(ben.mutation(api.tools.update, edit)).rejects.toEqual(code("FORBIDDEN"));
    await expect(root.mutation(api.tools.update, edit)).rejects.toEqual(code("FORBIDDEN"));
    await olga.mutation(api.tools.update, { ...edit, name: "Drill v2" });
    expect((await olga.query(api.tools.myListings, {}))[0].name).toBe("Drill v2");
  });

  it("a regular user cannot delete someone else's listing; an admin can", async () => {
    const { olga, ben, root } = await people();
    const toolId = await olga.mutation(api.tools.create, drill);
    await expect(ben.mutation(api.tools.remove, { toolId })).rejects.toEqual(code("FORBIDDEN"));
    await root.mutation(api.tools.remove, { toolId });
    expect(await olga.query(api.tools.myListings, {})).toEqual([]);
  });

  it("deleting a listing cancels open requests and tells the borrower", async () => {
    const { olga, ben } = await people();
    const toolId = await olga.mutation(api.tools.create, drill);
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: addDays(today(), 2), endDate: addDays(today(), 4) });
    await olga.mutation(api.tools.remove, { toolId });
    const [row] = await ben.query(api.loans.myRequests, {});
    expect(row._id).toBe(loanId);
    expect(row.status).toBe("cancelled");
  });

  it("an owner cannot delete a tool while it is lent out", async () => {
    const { olga, ben } = await people();
    const toolId = await olga.mutation(api.tools.create, drill);
    const loanId = await ben.mutation(api.loans.request, { toolId, startDate: today(), endDate: addDays(today(), 2) });
    await olga.mutation(api.loans.decide, { loanId, decision: "approve" });
    await expect(olga.mutation(api.tools.remove, { toolId })).rejects.toEqual(code("CONFLICT"));
    await olga.mutation(api.loans.markReturned, { loanId });
    await olga.mutation(api.tools.remove, { toolId });
  });

  it("validates listing fields", async () => {
    const { olga } = await people();
    await expect(olga.mutation(api.tools.create, { ...drill, name: " " })).rejects.toEqual(code("INVALID"));
    await expect(olga.mutation(api.tools.create, { ...drill, description: "x".repeat(5000) })).rejects.toEqual(code("INVALID"));
  });
});
