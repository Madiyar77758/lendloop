"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { AdminTab } from "@/components/AdminTab";
import { BrowseTab } from "@/components/BrowseTab";
import { IncomingTab } from "@/components/IncomingTab";
import { MyListingsTab } from "@/components/MyListingsTab";
import { MyRequestsTab } from "@/components/MyRequestsTab";
import { Loading } from "@/components/ui";

type TabId = "browse" | "listings" | "requests" | "incoming" | "admin";

export default function AppPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const [profileReady, setProfileReady] = useState(false);
  const [tab, setTab] = useState<TabId>("browse");

  // Create the profile row on first visit. The role is decided on the server, never here.
  useEffect(() => {
    if (!isAuthenticated) return;
    storeUser({}).then(() => setProfileReady(true), () => setProfileReady(false));
  }, [isAuthenticated, storeUser]);

  const me = useQuery(api.users.me, profileReady ? {} : "skip");

  if (isLoading || !profileReady || me === undefined) return <Loading />;
  if (me === null) return <p className="p-10 text-center">We could not load your profile. Please reload.</p>;

  const tabs: { id: TabId; label: string }[] = [
    { id: "browse", label: "Browse" },
    { id: "listings", label: "My listings" },
    { id: "requests", label: "My requests" },
    { id: "incoming", label: "Incoming requests" },
    ...(me.role === "admin" ? [{ id: "admin" as const, label: "Admin" }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Lend<span className="text-moss">Loop</span>
        </Link>
        <div className="flex items-center gap-3 text-sm text-ink/70">
          <span>{me.displayName}</span>
          {me.role === "admin" && <span className="rounded-full bg-ink px-2 py-0.5 text-xs text-white">admin</span>}
          <UserButton />
        </div>
      </header>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id ? "border-moss text-moss" : "border-transparent text-ink/60 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="py-6" role="tabpanel">
        {tab === "browse" && <BrowseTab />}
        {tab === "listings" && <MyListingsTab />}
        {tab === "requests" && <MyRequestsTab />}
        {tab === "incoming" && <IncomingTab />}
        {tab === "admin" && me.role === "admin" && <AdminTab />}
      </main>
    </div>
  );
}
