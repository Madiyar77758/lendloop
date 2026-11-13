import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { api } from "../../convex/_generated/api";

export const dynamic = "force-dynamic";

async function loadFeed() {
  try {
    return await fetchQuery(api.tools.listPublic, {});
  } catch {
    return null; // Convex unreachable: show the page without the feed instead of a 500.
  }
}

export default async function Home() {
  const feed = await loadFeed();

  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-moss">LendLoop</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Borrow what you need. Lend what you don&rsquo;t.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink/70">
        A neighborhood board for tools that sit unused 360 days a year. Ask a neighbor, pick your dates, bring it back.
      </p>

      <div className="mt-8">
        <SignedOut>
          <SignInButton mode="modal" forceRedirectUrl="/app">
            <button className="rounded-full bg-moss px-6 py-3 font-medium text-white transition hover:bg-moss-dark">
              Sign in to lend or borrow
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/app" className="inline-block rounded-full bg-moss px-6 py-3 font-medium text-white transition hover:bg-moss-dark">
            Open LendLoop
          </Link>
        </SignedIn>
      </div>

      <section className="mt-14" aria-labelledby="available">
        <h2 id="available" className="text-lg font-semibold">
          Available right now
        </h2>
        {feed === null ? (
          <p className="mt-3 text-ink/60">The list is temporarily unavailable.</p>
        ) : feed.length === 0 ? (
          <p className="mt-3 text-ink/60">Nothing listed yet. Be the first to share a tool.</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {feed.map((tool, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                <span className="font-medium">{tool.name}</span>
                <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs text-ink/70">{tool.category}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink/50">Who owns what, and how to request it, is for signed-in neighbors only.</p>
      </section>
    </main>
  );
}
