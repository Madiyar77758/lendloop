import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export type LoanEvent =
  | "loan.requested"
  | "loan.approved"
  | "loan.declined"
  | "loan.returned"
  | "loan.cancelled";

/**
 * Queue an outbound n8n notification. Runs after the mutation commits (the
 * scheduler is transactional), so a rolled-back mutation never notifies anyone.
 * The event id is deterministic, which lets n8n de-duplicate retries.
 */
export async function scheduleLoanEvent(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  event: LoanEvent,
  to: "owner" | "borrower",
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.notifications.dispatchLoanEvent, {
    eventId: `${loanId}:${event}`,
    event,
    loanId,
    to,
    attempt: 1,
  });
}
