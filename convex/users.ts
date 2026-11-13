import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, getViewer, requireAdmin } from "./lib/auth";

/**
 * Called by the client right after sign-in. Creates the profile row on first
 * visit. The role is never accepted from the client: every new user is "user".
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");

    const raw = identity.name || identity.nickname || identity.email?.split("@")[0] || "Neighbor";
    const displayName = raw.trim().slice(0, 60) || "Neighbor";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.displayName !== displayName || existing.email !== identity.email) {
        await ctx.db.patch(existing._id, { displayName, email: identity.email });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
      email: identity.email,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getViewer(ctx);
    if (!user) return null;
    return { _id: user._id, displayName: user.displayName, role: user.role, trustedLender: user.trustedLender };
  },
});

/** Admin only: lenders (people with at least one listing) and their trusted flag. */
export const listLenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(200);
    const rows = [];
    for (const user of users) {
      const tools = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).take(50);
      if (tools.length === 0) continue;
      rows.push({ _id: user._id, displayName: user.displayName, trustedLender: user.trustedLender, toolCount: tools.length });
    }
    return rows;
  },
});

/** Admin only: mark or unmark a lender as "Trusted Lender". */
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Internal-only bootstrap: there is deliberately no public way to become admin.
 *   npx convex run users:promoteToAdmin '{"email":"you@example.com"}'
 * The person must have signed in once so their profile exists.
 */
export const promoteToAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (!user) fail("NOT_FOUND", "No user with that email. Sign in once first.");
    await ctx.db.patch(user._id, { role: "admin" });
    return user._id;
  },
});
