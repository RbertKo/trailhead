import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "trailhead_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface Credentials {
  email: string;
  password: string;
}

type Env = Record<string, string | undefined>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The one account that may sign in. Null unless both values are set, and then
 * nobody gets in: a forgotten setting must not leave the app and its credits open.
 */
export function readCredentials(env: Env = process.env): Credentials | null {
  const email = normalizeEmail(env.AUTH_EMAIL ?? "");
  const password = env.AUTH_PASSWORD ?? "";
  return email && password.trim() ? { email, password } : null;
}

function sameText(a: string, b: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function credentialsMatch(
  attempt: Credentials,
  expected: Credentials,
): boolean {
  // Both comparisons always run, so timing doesn't reveal which one failed.
  const emailMatches = sameText(normalizeEmail(attempt.email), expected.email);
  const passwordMatches = sameText(attempt.password, expected.password);
  return emailMatches && passwordMatches;
}

// Keyed on the credentials, so there is no third value to configure, and changing
// the email or password signs everyone out.
function sign(expiresAt: number, { email, password }: Credentials): string {
  return createHmac("sha256", password)
    .update(`${email}\n${expiresAt}`)
    .digest("base64url");
}

export function createSessionToken(
  credentials: Credentials,
  now = Date.now(),
): string {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt, credentials)}`;
}

export function isValidSessionToken(
  token: string | undefined,
  credentials: Credentials | null,
  now = Date.now(),
): boolean {
  if (!token || !credentials) return false;

  const parts = /^(\d+)\.([\w-]+)$/.exec(token);
  if (!parts) return false;

  const expiresAt = Number(parts[1]);
  return expiresAt > now && sameText(parts[2], sign(expiresAt, credentials));
}
