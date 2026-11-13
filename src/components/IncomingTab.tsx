"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LoanRow } from "./LoanRow";
import { Button, Empty, ErrorLine, Loading, useAction } from "./ui";

export function IncomingTab() {
  const loans = useQuery(api.loans.incoming, {});
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, busy, error } = useAction();

  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>No one has asked to borrow your tools yet.</Empty>;

  return (
    <section>
      <ErrorLine message={error} />
      <ul className="grid gap-3">
        {loans.map((loan) => {
          const loanId = loan._id as Id<"loans">;
          return (
            <li key={loan._id}>
              <LoanRow
                loan={loan}
                who={`requested by ${loan.borrowerName}`}
                actions={
                  <>
                    {loan.status === "requested" && (
                      <>
                        <Button disabled={busy} onClick={() => void run(() => decide({ loanId, decision: "approve" }))}>
                          Approve
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={() => void run(() => decide({ loanId, decision: "decline" }))}>
                          Decline
                        </Button>
                      </>
                    )}
                    {loan.status === "approved" && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => markReturned({ loanId }))}>
                        Mark as returned
                      </Button>
                    )}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
