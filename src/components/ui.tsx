"use client";

import { useState, type ReactNode } from "react";
import { messageOf } from "@/lib/errors";

export const field =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-moss";

export function Button({
  children,
  variant = "primary",
  ...props
}: { variant?: "primary" | "ghost" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-moss text-white hover:bg-moss-dark",
    ghost: "border border-line bg-white hover:bg-paper",
    danger: "border border-clay/40 bg-white text-clay hover:bg-clay/5",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const styles = {
    neutral: "bg-paper text-ink/70",
    good: "bg-moss/10 text-moss",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-clay/10 text-clay",
  }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-white p-4">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink/60">{children}</p>;
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-ink/50">Loading…</p>;
}

/** Runs a mutation and keeps the error message next to the control that caused it. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-2 text-sm text-clay">
      {message}
    </p>
  ) : null;
}

export function statusTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (status === "approved" || status === "available" || status === "returned") return "good";
  if (status === "requested") return "warn";
  if (status === "declined" || status === "cancelled" || status === "overdue" || status === "on_loan") return "bad";
  return "neutral";
}
