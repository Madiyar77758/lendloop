import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireAdmin, requireViewer } from "./lib/auth";
import { MAX_LOAN_DAYS, daysBetween, isValidIsoDay, rangesOverlap, todayUtc } from "./lib/dates";
import { scheduleLoanEvent } from "./lib/events";

async function approvedOverlap(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  range: { startDate: string; endDate: string },
  excludeLoanId?: Id<"loans">,
): Promise<boolean> {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.some((l) => l._id !== excludeLoanId && l.status === "approved" && rangesOverlap(l, range));
}

async function lastReminderAt(ctx: QueryCtx, loanId: Id<"loans">): Promise<number | null> {
  const last = await ctx.db.query("reminders").withIndex("by_loan", (q) => q.eq("loanId", loanId)).order("desc").first();
  return last && last.status === "sent" ? last.sentAt : null;
}

async function toRow(ctx: QueryCtx, loan: Doc<"loans">) {
  const [owner, borrower] = await Promise.all([ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);
  return {
    _id: loan._id,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < todayUtc(),
    ownerName: owner?.displayName ?? "Neighbor",
    ownerTrusted: owner?.trustedLender ?? false,
    borrowerName: borrower?.displayName ?? "Neighbor",
    // Bonus: surfaced in the UI as "Reminder sent 2 days ago".
    lastReminderAt: await lastReminderAt(ctx, loan._id),
    requestedAt: loan._creationTime,
  };
}

/** Borrower side: requests I made. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id)).order("desc").take(100);
    return await Promise.all(loans.map((l) => toRow(ctx, l)));
  },
});

/** Lender side: requests on my tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_owner", (q) => q.eq("ownerId", viewer._id)).order("desc").take(100);
    return await Promise.all(loans.map((l) => toRow(ctx, l)));
  },
});

/** Admin only: every loan in the system. */
export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await Promise.all(loans.map((l) => toRow(ctx, l)));
  },
});

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Listing not found.");
    if (tool.ownerId === viewer._id) fail("INVALID", "You cannot borrow your own tool.");

    if (!isValidIsoDay(startDate) || !isValidIsoDay(endDate)) fail("INVALID", "Dates must look like YYYY-MM-DD.");
    if (startDate < todayUtc()) fail("INVALID", "The start date cannot be in the past.");
    if (endDate < startDate) fail("INVALID", "The end date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) fail("INVALID", `Loans are limited to ${MAX_LOAN_DAYS} days.`);

    const range = { startDate, endDate };
    if (await approvedOverlap(ctx, toolId, range)) fail("CONFLICT", "This tool is already booked for those dates.");

    const mine = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id)).collect();
    const duplicate = mine.some(
      (l) => l.toolId === toolId && (l.status === "requested" || l.status === "approved") && rangesOverlap(l, range),
    );
    if (duplicate) fail("CONFLICT", "You already have an open request for this tool in that period.");

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "requested",
    });
    await scheduleLoanEvent(ctx, loanId, "loan.requested", "owner");
    return loanId;
  },
});

async function loadOwnedLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const viewer = await requireViewer(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("NOT_FOUND", "Request not found.");
  // Only the lender acts on a request. Admins can see every loan but do not decide them.
  if (loan.ownerId !== viewer._id) fail("FORBIDDEN", "Only the tool's owner can do this.");
  return loan;
}

export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approve"), v.literal("decline")) },
  handler: async (ctx, { loanId, decision }) => {
    const loan = await loadOwnedLoan(ctx, loanId);
    if (loan.status !== "requested") fail("CONFLICT", "This request has already been handled.");

    if (decision === "approve") {
      if (loan.startDate < todayUtc()) fail("CONFLICT", "The requested start date has already passed.");
      if (await approvedOverlap(ctx, loan.toolId, loan, loan._id)) {
        fail("CONFLICT", "Another approved loan overlaps with these dates.");
      }
    }

    const status = decision === "approve" ? "approved" : "declined";
    await ctx.db.patch(loanId, { status, decidedAt: Date.now() });
    await scheduleLoanEvent(ctx, loanId, decision === "approve" ? "loan.approved" : "loan.declined", "borrower");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loadOwnedLoan(ctx, loanId);
    if (loan.status !== "approved") fail("CONFLICT", "Only approved loans can be marked as returned.");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await scheduleLoanEvent(ctx, loanId, "loan.returned", "borrower");
  },
});

/** The borrower withdraws their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Request not found.");
    if (loan.borrowerId !== viewer._id) fail("FORBIDDEN", "You can only cancel your own requests.");
    if (loan.status !== "requested") fail("CONFLICT", "Only pending requests can be cancelled.");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await scheduleLoanEvent(ctx, loanId, "loan.cancelled", "owner");
  },
});
