"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES } from "../../convex/lib/constants";
import { Badge, Button, Card, Empty, ErrorLine, Loading, field, statusTone, useAction } from "./ui";

type Category = (typeof CATEGORIES)[number];
const todayIso = () => new Date().toISOString().slice(0, 10);

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const { run, busy, error } = useAction();
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-paper p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, startDate: start, endDate: end }))) onDone();
      }}
    >
      <label className="text-xs text-ink/70">
        From
        <input type="date" required min={todayIso()} value={start} onChange={(e) => setStart(e.target.value)} className={`${field} mt-1`} />
      </label>
      <label className="text-xs text-ink/70">
        Until
        <input type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} className={`${field} mt-1`} />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <div className="w-full">
        <ErrorLine message={error} />
        <p className="text-xs text-ink/50">Up to 30 days. The owner will be notified.</p>
      </div>
    </form>
  );
}

export function BrowseTab() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const [openId, setOpenId] = useState<Id<"tools"> | null>(null);

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="category" className="text-sm text-ink/70">
          Category
        </label>
        <select id="category" value={category} onChange={(e) => setCategory(e.target.value as Category | "")} className={`${field} !w-auto`}>
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>No tools here yet.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool._id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{tool.name}</h3>
                  <Badge tone={statusTone(tool.status)}>{tool.status === "on_loan" ? "on loan" : "available"}</Badge>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/60">
                  <span>{tool.category}</span>·<span>{tool.condition}</span>
                </p>
                {tool.description && <p className="mt-2 text-sm text-ink/80">{tool.description}</p>}
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink/70">
                    {tool.isMine ? "You" : tool.ownerName}
                    {tool.ownerTrusted && <Badge tone="good">Trusted Lender</Badge>}
                  </span>
                  {!tool.isMine && openId !== tool._id && (
                    <Button variant="ghost" onClick={() => setOpenId(tool._id)}>
                      Request
                    </Button>
                  )}
                </div>
                {openId === tool._id && <RequestForm toolId={tool._id} onDone={() => setOpenId(null)} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
