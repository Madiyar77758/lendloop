import { convexTest } from "convex-test";
import { vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.ts");

export const N8N_SECRET = "test-n8n-secret";
export const AUTOMATION_SECRET = "test-automation-secret";
const ISSUER = "https://clerk.test";

export type T = ReturnType<typeof setup>;

export function setup() {
  return convexTest(schema, modules);
}

/** Environment every test starts from; individual tests override as needed. */
export function configureEnv() {
  process.env.N8N_WEBHOOK_URL = "http://n8n.test/webhook/loan-events";
  process.env.N8N_WEBHOOK_SECRET = N8N_SECRET;
  process.env.AUTOMATION_API_SECRET = AUTOMATION_SECRET;
  delete process.env.NOTIFY_INCLUDE_EMAIL;
}

export function as(t: T, subject: string, name: string) {
  return t.withIdentity({ subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, name, email: `${subject}@example.com` });
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Runs every scheduled notification to completion (fake timers must be on). */
export async function flush(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

export async function promote(t: T, email: string) {
  await t.mutation(internal.users.promoteToAdmin, { email });
}
