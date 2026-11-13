import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireViewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { scheduleLoanEvent } from "./lib/events";
import { categoryValidator, conditionValidator } from "./schema";

/** "on_loan" while an approved loan has started and has not been marked returned. */
async function toolStatus(ctx: QueryCtx, toolId: Id<"tools">): Promise<"available" | "on_loan"> {
  const today = todayUtc();
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.some((l) => l.status === "approved" && l.startDate <= today) ? "on_loan" : "available";
}

function cleanText(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    fail("INVALID", `Name must be ${LIMITS.nameMin}-${LIMITS.nameMax} characters.`);
  }
  if (description.length > LIMITS.descriptionMax) {
    fail("INVALID", `Description must be at most ${LIMITS.descriptionMax} characters.`);
  }
  return { name, description };
}

/**
 * Public landing page feed. Deliberately minimal: name and category only, no
 * ids, no owner details, no condition or description.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(60);
    const rows = [];
    for (const tool of tools) {
      if ((await toolStatus(ctx, tool._id)) === "available") rows.push({ name: tool.name, category: tool.category });
    }
    return rows;
  },
});

/** Signed-in browse view: all tools with availability, optionally filtered by category. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const viewer = await requireViewer(ctx);
    const tools = category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category)).order("desc").take(200)
      : await ctx.db.query("tools").order("desc").take(200);

    const rows = [];
    for (const tool of tools) {
      const owner = await ctx.db.get(tool.ownerId);
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        ownerName: owner?.displayName ?? "Neighbor",
        ownerTrusted: owner?.trustedLender ?? false,
        status: await toolStatus(ctx, tool._id),
        isMine: tool.ownerId === viewer._id,
      });
    }
    return rows;
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const tools = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", viewer._id)).order("desc").take(100);
    const rows = [];
    for (const tool of tools) {
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        status: await toolStatus(ctx, tool._id),
      });
    }
    return rows;
  },
});

export const create = mutation({
  args: { name: v.string(), category: categoryValidator, condition: conditionValidator, description: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const text = cleanText(args);
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      category: args.category,
      condition: args.condition,
      ...text,
    });
  },
});

/** Owners edit their own listings only. Admins can remove any listing, but not edit it. */
export const update = mutation({
  args: { toolId: v.id("tools"), name: v.string(), category: categoryValidator, condition: conditionValidator, description: v.string() },
  handler: async (ctx, { toolId, ...fields }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Listing not found.");
    if (tool.ownerId !== viewer._id) fail("FORBIDDEN", "You can only edit your own listings.");
    await ctx.db.patch(toolId, { category: fields.category, condition: fields.condition, ...cleanText(fields) });
  },
});

async function cancelOpenLoans(ctx: MutationCtx, tool: Doc<"tools">) {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", tool._id)).collect();
  for (const loan of loans) {
    if (loan.status !== "requested" && loan.status !== "approved") continue;
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    await scheduleLoanEvent(ctx, loan._id, "loan.cancelled", "borrower");
  }
}

/**
 * Owner can delete their own listing; admin can remove any listing.
 * An owner cannot delete a tool that is currently lent out. An admin can
 * (moderation). Either way, open requests and not-yet-started loans are
 * cancelled and the borrowers are notified.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Listing not found.");

    const isOwner = tool.ownerId === viewer._id;
    if (!isOwner && viewer.role !== "admin") fail("FORBIDDEN", "You can only delete your own listings.");

    if (isOwner && (await toolStatus(ctx, toolId)) === "on_loan") {
      fail("CONFLICT", "This tool is currently lent out. Mark it as returned first.");
    }

    await cancelOpenLoans(ctx, tool);
    await ctx.db.delete(toolId);
  },
});
