"use client";

import type { ReactNode } from "react";
import { Badge, Card, statusTone } from "./ui";

export type LoanRowData = {
  _id: string;
  toolName: string;
  startDate: string;
  endDate: string;
  status: "requested" | "approved" | "declined" | "returned" | "cancelled";
  overdue: boolean;
  ownerName: string;
  ownerTrusted: boolean;
  borrowerName: string;
  lastReminderAt: number | null;
  requestedAt: number;
};

function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

export function LoanRow({ loan, who, actions }: { loan: LoanRowData; who: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{loan.toolName}</h3>
          <p className="text-sm text-ink/70">{who}</p>
          <p className="mt-1 text-xs text-ink/60">
            {loan.startDate === loan.endDate ? loan.startDate : `${loan.startDate} → ${loan.endDate}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={statusTone(loan.status)}>{loan.status}</Badge>
          {loan.overdue && <Badge tone="bad">overdue</Badge>}
          {loan.lastReminderAt !== null && loan.overdue && <span className="text-xs text-ink/50">Reminder sent {daysAgo(loan.lastReminderAt)}</span>}
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}
