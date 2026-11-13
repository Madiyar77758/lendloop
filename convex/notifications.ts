import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { canonicalOutbound, sign } from "./lib/hmac";

export const MAX_ATTEMPTS = 5;
/** Delay before retry number `attempt + 1`: 10 s, 1 min, 5 min, 30 min. */
const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000];
const REQUEST_TIMEOUT_MS = 30_000; // n8n may retry its own delivery up to 3 times before answering

const toValidator = v.union(v.literal("owner"), v.literal("borrower"));

/**
 * Data minimization: the webhook gets only what a notification needs. No user
 * ids, no tool description, no condition, no owner or borrower details beyond
 * the display name of the recipient. The recipient's email is included only
 * when NOTIFY_INCLUDE_EMAIL=true (needed for a real email channel).
 */
export const buildPayload = internalQuery({
  args: { eventId: v.string(), event: v.string(), loanId: v.id("loans"), to: toValidator },
  handler: async (ctx, { eventId, event, loanId, to }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const recipient = await ctx.db.get(to === "owner" ? loan.ownerId : loan.borrowerId);
    if (!recipient) return null;

    return {
      eventId,
      event,
      occurredAt: new Date().toISOString(),
      loan: { id: loan._id, toolName: loan.toolName, startDate: loan.startDate, endDate: loan.endDate, status: loan.status },
      recipient: {
        role: to,
        displayName: recipient.displayName,
        ...(process.env.NOTIFY_INCLUDE_EMAIL === "true" && recipient.email ? { email: recipient.email } : {}),
      },
    };
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.string(),
    loanId: v.id("loans"),
    attempt: v.number(),
    status: v.union(v.literal("ok"), v.literal("retrying"), v.literal("failed")),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("automationLog", { kind: "webhook", ...args, detail: args.detail.slice(0, 300) });
  },
});

/**
 * Outbound webhook to n8n. Signed with HMAC-SHA256 over `${timestamp}.${body}`.
 * Failures retry with exponential backoff (re-scheduled, so it survives
 * restarts) and every attempt is written to `automationLog`, so a permanently
 * failed delivery is visible instead of silent.
 */
export const dispatchLoanEvent = internalAction({
  args: { eventId: v.string(), event: v.string(), loanId: v.id("loans"), to: toValidator, attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const payload = await ctx.runQuery(internal.notifications.buildPayload, {
      eventId: args.eventId,
      event: args.event,
      loanId: args.loanId,
      to: args.to,
    });
    if (!payload) return;

    const log = (status: "ok" | "retrying" | "failed", detail: string) =>
      ctx.runMutation(internal.notifications.recordAttempt, {
        eventId: args.eventId,
        loanId: args.loanId,
        attempt: args.attempt,
        status,
        detail,
      });

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await log("failed", "N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET are not configured");
      return;
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(secret, canonicalOutbound(timestamp, body));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-event-id": args.eventId,
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": signature,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`n8n responded with HTTP ${res.status}`);
      await log("ok", "delivered");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.attempt < MAX_ATTEMPTS) {
        await log("retrying", message);
        await ctx.scheduler.runAfter(BACKOFF_MS[args.attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1], internal.notifications.dispatchLoanEvent, {
          ...args,
          attempt: args.attempt + 1,
        });
      } else {
        await log("failed", `gave up after ${args.attempt} attempts: ${message}`);
      }
    } finally {
      clearTimeout(timer);
    }
  },
});
