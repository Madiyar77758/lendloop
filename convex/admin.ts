import { query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

/** Admin only: latest webhook deliveries and n8n failures, newest first. */
export const automationLog = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("automationLog").order("desc").take(50);
    return rows.map((r) => ({
      _id: r._id,
      at: r._creationTime,
      kind: r.kind,
      status: r.status,
      eventId: r.eventId ?? null,
      attempt: r.attempt ?? null,
      detail: r.detail,
    }));
  },
});
