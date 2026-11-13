import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

export const categoryValidator = v.union(
  v.literal("power tools"),
  v.literal("hand tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("like new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled"),
);

export default defineSchema({
  // One row per signed-in person. `role` is only ever written by server code
  // (default "user"; promotion happens through an internal mutation), never from client input.
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  // A borrow request and, once approved, the loan itself. Dates are YYYY-MM-DD (UTC).
  loans: defineTable({
    toolId: v.id("tools"),
    // Snapshot so notifications and history still make sense after a listing is removed.
    toolName: v.string(),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Write-back target for the n8n overdue workflow. `idempotencyKey` makes retries safe.
  reminders: defineTable({
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    channel: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    sentAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Visible trail for the automation: outbound webhook attempts and n8n failures.
  automationLog: defineTable({
    kind: v.union(v.literal("webhook"), v.literal("error")),
    status: v.union(v.literal("ok"), v.literal("retrying"), v.literal("failed")),
    eventId: v.optional(v.string()),
    loanId: v.optional(v.id("loans")),
    attempt: v.optional(v.number()),
    detail: v.string(),
  }).index("by_event", ["eventId"]),
});
