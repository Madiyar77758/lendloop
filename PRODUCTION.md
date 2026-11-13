# Taking LendLoop to production

What works today is a complete local/staging setup. These are the changes I would make, roughly in priority order, before real users depend on it.

## 1. Environments and secrets
* **Separate Clerk and Convex production instances.** Dev and prod must not share issuers, deployments or secrets. Set `CLERK_JWT_ISSUER_DOMAIN` of the production Clerk instance on the production Convex deployment.
* **Secret rotation.** Both HMAC secrets should be rotatable without downtime: accept `current` and `previous` for a window (a two-value list in the verifier), then retire the old one. Generate with a CSPRNG (`openssl rand -hex 32`), store in a secret manager, never in compose files or chat.
* **Stop reading secrets from `$env` in n8n Code nodes.** The compose file sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` for that. In production use n8n external secrets or credentials (and a signing sub-workflow), and turn the flag back on. Keep `NODE_FUNCTION_ALLOW_BUILTIN` to `crypto` only.

## 2. Networking
* Replace the quick tunnel with a **stable HTTPS hostname** in front of n8n and keep exposing only `POST /webhook/lendloop/loan-events` (the `edge` Caddy config shows the shape). The n8n editor and API stay private (VPN / SSO / IP allow-list).
* Convex → n8n requests are already authenticated, but add an **IP/firewall rule** or mTLS if the host allows it, and a request-size limit (already 64 KB at the edge).
* Serve the app over HTTPS only; add HSTS and a **Content-Security-Policy** (Clerk's script/frame origins need to be allowed).

## 3. n8n
* Move from SQLite to **Postgres** and run **queue mode** with a worker and Redis for throughput and zero-downtime upgrades. Pin the image version, back up the database, set `N8N_ENCRYPTION_KEY` once and keep it.
* **Durable de-duplication.** Today delivered event ids live in workflow static data and are reset when workflows are re-imported. Make the *consumer* idempotent in a durable place: either a small Convex table (`deliveredEvents`) that n8n checks and writes through a signed endpoint, or Redis with a TTL. Import workflows from CI, not on every container start.
* **A real notification channel.** Replace the log/webhook Code node with email (Resend, Postmark, SES) and/or push, with templates, an unsubscribe link, and `NOTIFY_INCLUDE_EMAIL=true` only for the email path. Respect user notification preferences.
* Add a **dead-letter path**: events that exhaust Convex's 5 attempts should be re-drivable from the admin UI (a "retry" button on `automationLog` rows) rather than only visible.

## 4. Convex / application
* **Rate limiting** on mutations (request, create listing, cancel) with the Convex rate-limiter component, plus per-user caps (open requests, listings) to stop abuse and notification spam.
* **Pagination** instead of `take(200)` for browse, loans and the log; add indexes by the queries that actually appear in production.
* **Time zones.** Store each lender's time zone (or a neighborhood time zone) and compute "today", "overdue" and the 09:00 schedule from it instead of UTC.
* **Admin management.** An audited UI/CLI flow for granting and revoking admin, an **audit log** of admin actions (trusted-lender changes, moderation deletes), and at least two admins.
* **Data lifecycle.** Account deletion that anonymizes loans, retention for `automationLog` and `reminders` (a scheduled cleanup), and a privacy notice describing what is stored. Emails are stored only because Clerk provides them; consider dropping the column unless an email channel is enabled.
* **Abuse handling**: report a listing, block a user, optional identity/address verification for lenders.

## 4a. Trust and safety (product)
Tools are physical, valuable things. Before launch decide on deposits or damage policy, how disputes are handled, and what "Trusted Lender" requires (today it is an admin's judgment call).

## 5. Observability and operations
* Alert on `automationLog` entries with `status = failed` and on n8n error-workflow executions (page or Slack); a dashboard for delivery success rate and retry counts.
* Structured logs with a correlation id (use the event id) across Convex and n8n.
* A health check for the webhook path and a synthetic event on a schedule.
* **CI**: typecheck, unit tests, `next build`, workflow JSON validation, a smoke test that boots n8n with the three workflows and sends a signed event (the same script used here), dependency audit, secret scanning.
* Backups and a restore drill (Convex snapshots/export, n8n database), and a runbook for "n8n is down" (what retries, when it gives up, how to replay).

## 6. Testing
* Add end-to-end tests (Playwright) against a Clerk test instance for the sign-in and request flow.
* Contract tests for the webhook payload and the three HTTP endpoints, shared by both sides.
* Load test the request/approve path to confirm the overlap check holds under concurrent approvals (Convex mutations are serializable, but this is worth proving).
