"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS } from "../../convex/lib/constants";
import { Badge, Button, Card, Empty, ErrorLine, Loading, field, statusTone, useAction } from "./ui";

type Category = (typeof CATEGORIES)[number];
type Condition = (typeof CONDITIONS)[number];
type Draft = { name: string; category: Category; condition: Condition; description: string };
const blank: Draft = { name: "", category: "power tools", condition: "good", description: "" };

function ToolForm({ initial, submitLabel, onSubmit, onCancel }: { initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<unknown>; onCancel?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const { run, busy, error } = useAction();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => onSubmit(draft)) && !onCancel) setDraft(blank);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          required
          minLength={LIMITS.nameMin}
          maxLength={LIMITS.nameMax}
          placeholder="Name, e.g. Cordless drill"
          aria-label="Name"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          className={`${field} sm:col-span-1`}
        />
        <select aria-label="Category" value={draft.category} onChange={(e) => set("category", e.target.value as Category)} className={field}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Condition" value={draft.condition} onChange={(e) => set("condition", e.target.value as Condition)} className={field}>
          {CONDITIONS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <textarea
        maxLength={LIMITS.descriptionMax}
        placeholder="Anything a borrower should know (optional)"
        aria-label="Description"
        rows={2}
        value={draft.description}
        onChange={(e) => set("description", e.target.value)}
        className={field}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <ErrorLine message={error} />
    </form>
  );
}

function ListingRow({ tool }: { tool: { _id: Id<"tools">; name: string; category: Category; condition: Condition; description: string; status: string } }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const del = useAction();

  return (
    <Card>
      {editing ? (
        <ToolForm
          initial={{ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description }}
          submitLabel="Save changes"
          onSubmit={async (d) => {
            await update({ toolId: tool._id, ...d });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{tool.name}</h3>
              <p className="text-xs text-ink/60">
                {tool.category} · {tool.condition}
              </p>
            </div>
            <Badge tone={statusTone(tool.status)}>{tool.status === "on_loan" ? "on loan" : "available"}</Badge>
          </div>
          {tool.description && <p className="mt-2 text-sm text-ink/80">{tool.description}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="danger"
              disabled={del.busy}
              onClick={() => {
                if (window.confirm(`Delete "${tool.name}"? Open requests for it will be cancelled.`)) void del.run(() => remove({ toolId: tool._id }));
              }}
            >
              Delete
            </Button>
          </div>
          <ErrorLine message={del.error} />
        </>
      )}
    </Card>
  );
}

export function MyListingsTab() {
  const tools = useQuery(api.tools.myListings, {});
  const create = useMutation(api.tools.create);

  return (
    <section className="grid gap-6">
      <Card>
        <h2 className="mb-3 font-semibold">Share a tool</h2>
        <ToolForm initial={blank} submitLabel="Add listing" onSubmit={(d) => create(d)} />
      </Card>
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>You have not listed anything yet.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id}>
              <ListingRow tool={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
