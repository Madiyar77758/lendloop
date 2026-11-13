"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LoanRow } from "./LoanRow";
import { Badge, Button, Empty, ErrorLine, Loading, useAction } from "./ui";

export function MyRequestsTab() {
  const loans = useQuery(api.loans.myRequests, {});
  const cancel = useMutation(api.loans.cancel);
  const { run, busy, error } = useAction();

  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>You have not requested anything yet. Browse the board to get started.</Empty>;

  return (
    <section>
      <ErrorLine message={error} />
      <ul className="grid gap-3">
        {loans.map((loan) => (
          <li key={loan._id}>
            <LoanRow
              loan={loan}
              who={
                <span className="inline-flex items-center gap-2">
                  from {loan.ownerName}
                  {loan.ownerTrusted && <Badge tone="good">Trusted Lender</Badge>}
                </span>
              }
              actions={
                loan.status === "requested" && (
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => cancel({ loanId: loan._id as Id<"loans"> }))}>
                    Cancel request
                  </Button>
                )
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
