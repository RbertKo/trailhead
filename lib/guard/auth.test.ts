import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  credentialsMatch,
  isValidSessionToken,
  readCredentials,
  SESSION_MAX_AGE_SECONDS,
} from "./auth";

const ACCOUNT = { email: "learner@example.com", password: "Correct-Horse 9" };

describe("readCredentials", () => {
  it("reads both values and normalizes the email", () => {
    expect(
      readCredentials({
        AUTH_EMAIL: " Learner@Example.com ",
        AUTH_PASSWORD: "Correct-Horse 9",
      }),
    ).toEqual(ACCOUNT);
  });

  it.each([
    [{}],
    [{ AUTH_EMAIL: "learner@example.com" }],
    [{ AUTH_PASSWORD: "secret" }],
    [{ AUTH_EMAIL: "", AUTH_PASSWORD: "secret" }],
    [{ AUTH_EMAIL: "   ", AUTH_PASSWORD: "secret" }],
    [{ AUTH_EMAIL: "learner@example.com", AUTH_PASSWORD: "" }],
    [{ AUTH_EMAIL: "learner@example.com", AUTH_PASSWORD: "   " }],
  ])("treats %j as not configured", (env) => {
    expect(readCredentials(env)).toBeNull();
  });
});

describe("credentialsMatch", () => {
  it("accepts the right email and password", () => {
    expect(credentialsMatch({ ...ACCOUNT }, ACCOUNT)).toBe(true);
  });

  it("ignores case and surrounding space in the email only", () => {
    expect(
      credentialsMatch({ ...ACCOUNT, email: " LEARNER@example.com " }, ACCOUNT),
    ).toBe(true);
    expect(
      credentialsMatch({ ...ACCOUNT, password: "correct-horse 9" }, ACCOUNT),
    ).toBe(false);
    expect(
      credentialsMatch({ ...ACCOUNT, password: " Correct-Horse 9" }, ACCOUNT),
    ).toBe(false);
  });

  it.each([
    [{ ...ACCOUNT, email: "other@example.com" }],
    [{ ...ACCOUNT, password: "wrong" }],
    [{ email: "", password: "" }],
    [{ ...ACCOUNT, password: "much longer than the real password ".repeat(20) }],
  ])("rejects %j", (attempt) => {
    expect(credentialsMatch(attempt, ACCOUNT)).toBe(false);
  });
});

describe("session tokens", () => {
  const NOW = 1_800_000_000_000;
  const token = createSessionToken(ACCOUNT, NOW);

  it("holds up until it expires", () => {
    const expiry = NOW + SESSION_MAX_AGE_SECONDS * 1000;

    expect(isValidSessionToken(token, ACCOUNT, NOW)).toBe(true);
    expect(isValidSessionToken(token, ACCOUNT, expiry - 1)).toBe(true);
    expect(isValidSessionToken(token, ACCOUNT, expiry)).toBe(false);
  });

  it("stops working when the email or password changes", () => {
    expect(
      isValidSessionToken(token, { ...ACCOUNT, password: "changed" }, NOW),
    ).toBe(false);
    expect(
      isValidSessionToken(token, { ...ACCOUNT, email: "new@example.com" }, NOW),
    ).toBe(false);
  });

  it("rejects everything once the credentials are removed", () => {
    expect(isValidSessionToken(token, null, NOW)).toBe(false);
  });

  it("can't have its expiry pushed back", () => {
    const [expiresAt, signature] = token.split(".");
    const extended = `${Number(expiresAt) + 1}.${signature}`;

    expect(isValidSessionToken(extended, ACCOUNT, NOW)).toBe(false);
  });

  it("rejects a flipped signature", () => {
    const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(isValidSessionToken(flipped, ACCOUNT, NOW)).toBe(false);
  });

  it.each([
    undefined,
    "",
    "not-a-token",
    ".",
    `${NOW}.`,
    `.${"a".repeat(43)}`,
    `abc.${"a".repeat(43)}`,
    `${NOW}.${"a".repeat(43)}.extra`,
    `${"9".repeat(400)}.${"a".repeat(43)}`,
  ])("rejects the malformed token %j", (malformed) => {
    expect(isValidSessionToken(malformed, ACCOUNT, NOW)).toBe(false);
  });
});
