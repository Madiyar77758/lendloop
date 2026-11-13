import { ConvexError } from "convex/values";

/** Turns a Convex error into a message that is safe to show. Unknown errors stay generic. */
export function messageOf(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data && typeof data.message === "string") return data.message;
  }
  return "Something went wrong. Please try again.";
}
