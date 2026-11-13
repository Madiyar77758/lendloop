"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { LoanRow } from "./LoanRow";
import { Badge, Button, Card, Empty, ErrorLine, Loading, statusTone, useAction } from "./ui";

function Lenders() {
  const lenders = useQuery(api.users.listLenders, {});
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { run, busy, error } = useAction();

  return (
    <section>
      <h2 className="mb-3 font-semibold">Lenders</h2>
      <ErrorLine message={error} />
      {lenders === undefined ? (
        <Loading />
      ) : lenders.length === 0 ? (
        <Empty>No one has listed a tool yet.</Empty>
      ) : (
        <ul className="grid gap-2">
          {lenders.map((l) => (
            <li key={l._id}>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium">{l.displayName}</span>
                    <span className="ml-2 text-xs text-ink/60">
                      {l.toolCount} listing{l.toolCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {l.trustedLender && <Badge tone="good">Trusted Lender</Badge>}
                    <Button variant={l.trustedLender ? "ghost" : "primary"} disabled={busy} onClick={() => void run(() => setTrusted({ userId: l._id, trusted: !l.trustedLender }))}>
                      {l.trustedLender ? "Remove trusted" : "Mark trusted"}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AllLoans() {
  const loans = useQuery(api.loans.adminAll, {});
  return (
    <section>
      <h2 className="mb-3 font-semibold">All loans</h2>
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <Empty>No loans yet.</Empty>
      ) : (
        <ul className="grid gap-3">
          {loans.map((loan) => (
            <li key={loan._id}>
              <LoanRow loan={loan} who={`${loan.ownerName} → ${loan.borrowerName}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AutomationLog() {
  const rows = useQuery(api.admin.automationLog, {});
  return (
    <section>
      <h2 className="mb-1 font-semibold">Automation log</h2>
      <p className="mb-3 text-sm text-ink/60">Webhook deliveries to n8n and failures reported by n8n workflows.</p>
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper text-ink/60">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempt</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2">{new Date(r.at).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === "ok" ? "good" : r.status === "retrying" ? "warn" : statusTone("declined")}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2">{r.attempt ?? "–"}</td>
                  <td className="px-3 py-2 text-ink/70">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminTab() {
  return (
    <div className="grid gap-10">
      <Lenders />
      <AllLoans />
      <AutomationLog />
    </div>
  );
}
