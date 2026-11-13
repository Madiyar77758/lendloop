import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween, todayUtc } from "./lib/dates";

/** Approved, not returned, due date in the past. Read by the n8n daily workflow. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(200);

    const includeEmail = process.env.NOTIFY_INCLUDE_EMAIL === "true";
    const rows = [];
    for (const loan of loans) {
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower) continue;
      // Lets the workflow skip loans it already reminded today (safe manual re-runs).
      const last = await ctx.db.query("reminders").withIndex("by_loan", (q) => q.eq("loanId", loan._id)).order("desc").first();
      rows.push({
        loanId: loan._id,
        toolName: loan.toolName,
        borrowerName: borrower.displayName,
        ...(includeEmail && borrower.email ? { borrowerEmail: borrower.email } : {}),
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        lastReminderAt: last && last.status === "sent" ? last.sentAt : null,
      });
    }
    return rows;
  },
});

/**
 * Idempotent write-back. n8n retries (and re-runs of the schedule on the same
 * day) send the same `idempotencyKey`, so they can never create a second
 * reminder row.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    channel: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey.length > 120 || args.channel.length > 40) return { ok: false as const, reason: "invalid" as const };

    const existing = await ctx.db.query("reminders").withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (existing) return { ok: true as const, duplicate: true as const };

    const loan = await ctx.db.get(args.loanId);
    if (!loan) return { ok: false as const, reason: "loan_not_found" as const };

    await ctx.db.insert("reminders", { ...args, sentAt: Date.now() });
    return { ok: true as const, duplicate: false as const };
  },
});

/** Failures reported by the n8n error workflow. De-duplicated by `eventId`. */
export const recordError = internalMutation({
  args: { eventId: v.string(), detail: v.string() },
  handler: async (ctx, { eventId, detail }) => {
    const existing = await ctx.db.query("automationLog").withIndex("by_event", (q) => q.eq("eventId", eventId)).first();
    if (existing) return { duplicate: true as const };
    await ctx.db.insert("automationLog", { kind: "error", status: "failed", eventId, detail: detail.slice(0, 300) });
    return { duplicate: false as const };
  },
});
