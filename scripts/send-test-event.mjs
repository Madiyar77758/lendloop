#!/usr/bin/env node
// Sends a correctly signed loan event to n8n, exactly like the Convex action does.
// Handy for checking the n8n side without Convex or a tunnel.
//
//   N8N_WEBHOOK_URL=http://localhost:5678/webhook/lendloop/loan-events \
//   N8N_WEBHOOK_SECRET=... node scripts/send-test-event.mjs [event] [eventId] [--bad-signature|--stale] [--tool=Name]
//
// Run it twice with the same eventId to see de-duplication.
import { createHmac } from "node:crypto";

const url = process.env.N8N_WEBHOOK_URL;
const secret = process.env.N8N_WEBHOOK_SECRET;
if (!url || !secret) {
  console.error("Set N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET.");
  process.exit(1);
}

const [event = "loan.requested", eventId = `demo-loan:${event}`] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const toolName = process.argv.slice(2).find((a) => a.startsWith("--tool="))?.slice(7) ?? "Cordless drill";

const body = JSON.stringify({
  eventId,
  event,
  occurredAt: new Date().toISOString(),
  loan: { id: "demo-loan", toolName, startDate: "2030-01-10", endDate: "2030-01-12", status: "requested" },
  recipient: { role: event === "loan.requested" ? "owner" : "borrower", displayName: "Demo Neighbor" },
});

const timestamp = String(Math.floor(Date.now() / 1000) - (flags.has("--stale") ? 3600 : 0));
let signature = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
if (flags.has("--bad-signature")) signature = signature.slice(0, -4) + "0000";

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
  body,
});
console.log(res.status, await res.text());
