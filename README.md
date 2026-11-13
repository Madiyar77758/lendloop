# LendLoop

[![CI](https://github.com/Madiyar77758/lendloop/actions/workflows/ci.yml/badge.svg)](https://github.com/Madiyar77758/lendloop/actions/workflows/ci.yml)

> **Borrow what you need. Lend what you don't.**

A neighborhood board for lending tools. Neighbors list what they own, others request it for a date range, the owner approves or declines, and an n8n automation keeps everybody informed (including a daily reminder when something is overdue).

**Stack:** Next.js 15 (App Router) · Clerk (auth) · Convex (database, server functions, HTTP endpoints) · n8n (automation) · Tailwind 4 · Vitest + convex-test

---

## What is in the box

| Requirement | Where |
|---|---|
| Public landing page: tagline, "Sign in to lend or borrow", available tools (name + category only) | `src/app/page.tsx`, `convex/tools.ts` → `listPublic` |
| Signed-in app with tabs: Browse (category filter), My listings, My requests, Incoming requests, Admin | `src/app/app/page.tsx`, `src/components/*Tab.tsx` |
| Roles `admin` / `user`, enforced on the server | `convex/lib/auth.ts`, every function in `convex/*.ts` |
| Admin: mark lenders "Trusted Lender", see all loans | `convex/users.ts`, `convex/loans.ts` → `adminAll`, `AdminTab` |
| Loan lifecycle with date-overlap protection | `convex/loans.ts` |
| n8n flow 1: notify on request / approve / decline / return / cancel | `n8n/workflows/loan-events.json`, `convex/notifications.ts` |
| n8n flow 2: daily overdue reminders written back to Convex | `n8n/workflows/overdue-reminders.json`, `convex/http.ts`, `convex/automation.ts` |
| n8n flow 3: error workflow reporting failures to Convex | `n8n/workflows/error-handler.json` |
| Signed webhooks both directions, retries, idempotency | see *Security and reliability decisions* |
| Bonus: "Reminder sent N days ago" on overdue loans | `LoanRow.tsx`, `lastReminderAt` |
| Bonus: automation log for admins (delivery attempts, n8n failures) | `AdminTab` → *Automation log*, `convex/admin.ts` |
| Tests (RBAC, overlap, HMAC, retries, idempotency) | `tests/` — 49 tests |
| Production notes | [`PRODUCTION.md`](./PRODUCTION.md) |

## Architecture

```
                    ┌────────────────────────── Clerk ──────────────────────────┐
                    │  sign-in, sessions, JWT template "convex"                  │
                    └──────────────┬─────────────────────────────────────────────┘
                                   │ JWT
 Browser ── Next.js (middleware protects /app) ── Convex React client ──┐
                                                                        ▼
                                         ┌───────────────  Convex  ───────────────┐
                                         │ queries / mutations (RBAC on server)   │
                                         │ scheduler → notifications.dispatch...  │
                                         │ HTTP actions  /automation/*            │
                                         └───────┬──────────────────────▲─────────┘
        signed webhook  (HMAC N8N_WEBHOOK_SECRET)│                      │ signed requests (HMAC AUTOMATION_API_SECRET)
        retried with backoff, logged             ▼                      │
                                         ┌────────────────  n8n  ───────┴─────────┐
                                         │ 1. loan events → notification          │
                                         │ 2. daily overdue → notify → write back │
                                         │ 3. error workflow → report to Convex   │
                                         └────────────────────────────────────────┘
```

* The browser only ever talks to Convex through its authenticated client; there are no custom API routes to guard.
* A loan state change schedules an event **inside the same transaction** (Convex scheduler), so a rolled-back change never notifies anyone and a committed one is never lost.
* n8n never touches the database. It can only call three signed HTTP endpoints.

## Local setup

Prerequisites: Node 20+, a Clerk account, a Convex account, Docker (for n8n).

```bash
npm install
cp .env.example .env.local        # fill in the Clerk keys (Convex URL is added by `convex dev`)
```

### 1. Clerk
1. Create an application at clerk.com.
2. Enable the Convex integration (Dashboard → *Integrations* → *Convex*) — or create a JWT template named `convex` by hand. Copy its **Issuer** URL.
3. Put the publishable and secret keys into `.env.local`.

### 2. Convex
```bash
npx convex dev                                            # creates a dev deployment, pushes functions, keeps running
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set N8N_WEBHOOK_SECRET      "$(openssl rand -hex 32)"
npx convex env set AUTOMATION_API_SECRET   "$(openssl rand -hex 32)"
```
Remember the two values you generated: n8n needs the same ones. (`npx convex env get N8N_WEBHOOK_SECRET` prints them again.)

`convex/_generated/` is committed so that typecheck and tests run without a deployment; `convex dev` regenerates it.

### 3. n8n
```bash
cp n8n/.env.example n8n/.env      # paste the same two secrets, set CONVEX_SITE_URL (https://<deployment>.convex.site)
docker compose up -d              # editor on http://localhost:5678 (localhost only)
```
On start the container imports and publishes the three workflows from `n8n/workflows/`. Create the n8n owner account in the editor on first visit. Nothing needs to be configured by hand: no credentials are stored in n8n, the signing secrets come from the container environment.

Convex (in the cloud) has to reach n8n. For local development use the bundled tunnel, which exposes **only** the loan-events webhook:
```bash
docker compose --profile tunnel up -d
docker compose logs tunnel | grep trycloudflare      # the public https URL
npx convex env set N8N_WEBHOOK_URL https://<that-host>/webhook/lendloop/loan-events
```
(Any other tunnel such as ngrok works too; point it at `http://localhost:5678` and keep the editor behind its login.)

### 4. Run
```bash
npm run dev          # http://localhost:3000
```
Sign in once, then make yourself admin (there is deliberately no way to do this from the UI):
```bash
npx convex run users:promoteToAdmin '{"email":"you@example.com"}'
```

### Handy checks
```bash
npm run typecheck
npm test                                           # 49 tests, no external services needed
node scripts/send-test-event.mjs loan.requested evt-1             # signed event straight to n8n
node scripts/send-test-event.mjs loan.requested evt-1             # same id again → {"status":"duplicate"}
node scripts/send-test-event.mjs loan.requested evt-2 --bad-signature   # → 401
```
(`scripts/send-test-event.mjs` reads `N8N_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET` from the environment; locally the URL is `http://localhost:5678/webhook/lendloop/loan-events`.)

The daily reminder runs at 09:00 (container time zone, `GENERIC_TIMEZONE`). To try it now, open the *Daily overdue reminders* workflow in the editor and press **Execute workflow** (the *Run manually* trigger).

By default a notification is written to the n8n execution log (that is the "mock" channel: you can see every message in the execution details). Set `NOTIFY_WEBHOOK_URL` in `n8n/.env` to a Slack/Mattermost-style incoming webhook to also post it there. Swapping the *Send notification* Code node for an *Email* or *Slack* node is a one-node change.

## Roles and permissions

| Action | signed out | user | owner of the tool | admin |
|---|:-:|:-:|:-:|:-:|
| See public list (name + category) | ✔ | ✔ | ✔ | ✔ |
| Browse with owner, condition, description | ✘ | ✔ | ✔ | ✔ |
| Create a listing | ✘ | ✔ | – | ✔ |
| Edit a listing | ✘ | ✘ | ✔ | ✘ |
| Delete a listing | ✘ | ✘ | ✔ (not while lent out) | ✔ (moderation) |
| Request a loan | ✘ | ✔ (not own tool) | ✘ | ✔ |
| Approve / decline / mark returned | ✘ | ✘ | ✔ | ✘ |
| Cancel a pending request | ✘ | only the borrower | ✘ | ✘ |
| Mark / unmark Trusted Lender, see all loans and the automation log | ✘ | ✘ | ✘ | ✔ |

The UI hides what you cannot do, but that is cosmetic: every Convex function re-derives the caller from the verified JWT and checks the rule above (`requireViewer` / `requireAdmin`, ownership checks). The role is read from the database row; a client can neither send nor change it. Every new profile is a plain `user`; the only path to `admin` is an internal Convex function that can be run only by someone with deployment access.

## Security and reliability decisions

**Webhooks are signed in both directions, with two different secrets.**
Convex → n8n signs `HMAC-SHA256(secret, "<unix-seconds>.<raw body>")`; n8n → Convex signs `HMAC-SHA256(secret, "<unix-seconds>.<METHOD>.<path>.<raw body>")`. Separate secrets mean a leak of one direction does not let an attacker act in the other; binding method and path means a captured signature cannot be replayed against another endpoint. Both sides check the timestamp (±5 minutes) to limit replay and compare in constant time (`crypto.subtle.verify` in Convex, `timingSafeEqual` in n8n). The signature is computed over the exact raw bytes, never over re-serialised JSON. Unsigned, stale or tampered requests get 401; a missing secret fails closed (503).

**Secrets live in environment variables only** (`.env.local`, Convex env, `n8n/.env`), all git-ignored; `.env.example` files hold placeholders. Nothing is hard-coded in the workflow JSON files, and n8n holds no stored credentials.

**Data minimization.** The webhook carries the event name, loan id and dates, the tool name, and the recipient's *display name*. No user ids, no tool description or condition, no email address (an email is added only when `NOTIFY_INCLUDE_EMAIL=true`, for deployments that send real email). The overdue endpoint returns the same minimal set. The public landing page shows only name and category.

**Delivery is at-least-once, made safe by idempotency.**
* Convex retries a failed webhook up to 5 times with backoff (10 s, 1 min, 5 min, 30 min) using the scheduler, so retries survive restarts. Every attempt is written to `automationLog`; a delivery that finally fails is visible to admins instead of silent.
* Event ids are deterministic (`<loanId>:<event>`). n8n remembers delivered ids (7 days) and answers `duplicate` without notifying twice. An id is recorded only *after* a successful delivery, so a failed attempt can be retried.
* n8n retries its own delivery step 3 times, and its HTTP calls to Convex 3 times.
* Reminder write-back is idempotent: the key is `<loanId>:<YYYY-MM-DD>`, so retries and manual re-runs never create a second record. A workflow run also skips loans that already got a reminder today. A failed delivery is stored under a different key (`…:failed`), so it can never block a later successful reminder.

**Failures are reported, not swallowed.** One broken loan does not stop the others in the reminder run, but the run then fails on purpose so that the error workflow reports it to Convex (`/automation/errors`, de-duplicated by execution id), where admins see it in the Automation log.

**Business rules** are enforced on the server and tested: dates must be valid `YYYY-MM-DD`, not in the past, end ≥ start, at most 30 days; overlapping *approved* loans are rejected both when requesting and again when approving (two pending requests can coexist, only one can be approved); a borrower cannot hold two overlapping open requests for the same tool; an owner cannot delete a tool while it is lent out; deleting a tool cancels its open requests and notifies the borrowers.

**Other.** Next.js middleware protects `/app`, but is treated as a convenience: Convex re-checks everything. Security headers are set in `next.config.ts`. Text input is length-limited on the server; React escapes output; notification text strips line breaks from user-supplied names.

## Trade-offs and known limits

* **Dedup memory lives in n8n's workflow static data.** It is lost if the workflows are re-imported (which `docker compose up` does at start), so a restart in the middle of a retry window could send one duplicate notification. See `PRODUCTION.md` for the durable version.
* **Dates are UTC calendar days**, not the lender's local day.
* **"On loan" is derived**: an approved loan whose start date has arrived and which is not marked returned.
* **Lists are capped** (`take(200)`) rather than paginated; fine for a neighborhood, not for a city.
* **n8n quick tunnels get a new URL on every start**; update `N8N_WEBHOOK_URL` when that happens.

## Verification status

* `npm run typecheck`, `npm test` (49 tests) and `next build` pass.
* The three n8n workflows were executed on a local n8n **2.47.5** against a stand-in server that applies the same HMAC rules as `convex/http.ts`: valid, bad-signature, stale and unsigned requests; duplicate events; every event type; delivery failure, retries and recovery on the same event id; the daily run (skip already-reminded, failed delivery recorded, error workflow report). That run is how it was found that n8n 2.x only calls an error workflow that is *published*.
* Not exercised in this environment: a live Clerk sign-in, a live Convex deployment, and `docker compose up` itself (the compose file passes `docker compose config`, but no Docker daemon was available). Those are the first things to check after cloning.
