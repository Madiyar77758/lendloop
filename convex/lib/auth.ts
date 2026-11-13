import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT";

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

/** The signed-in user's row, or null (signed out, or `users.store` has not run yet). */
export async function getViewer(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewer(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const viewer = await getViewer(ctx);
  if (!viewer) fail("UNAUTHENTICATED", "Sign in to continue.");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") fail("FORBIDDEN", "Admin access required.");
  return viewer;
}
