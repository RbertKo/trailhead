import { describe, expect, it } from "vitest";

import {
  createRateLimiter,
  DEFAULT_REQUESTS_PER_DAY,
  DEFAULT_REQUESTS_PER_MINUTE,
  parseRequestsPerDay,
  parseRequestsPerMinute,
} from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit and blocks the next one", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });

    expect(check("a").allowed).toBe(true);
    expect(check("a").allowed).toBe(true);
    expect(check("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("counts each key separately", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

    expect(check("a").allowed).toBe(true);
    expect(check("b").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
  });

  it("starts a new window once the old one ends", () => {
    let time = 0;
    const check = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => time,
    });

    expect(check("a").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
    time = 1000;
    expect(check("a").allowed).toBe(true);
  });

  it("keeps working when the number of tracked keys reaches its cap", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

    for (let index = 0; index < 10_001; index += 1) {
      expect(check(`key-${index}`).allowed).toBe(true);
    }
    expect(check("key-10000").allowed).toBe(false);
  });
});

describe("parseRequestsPerMinute", () => {
  it("uses a valid positive integer", () => {
    expect(parseRequestsPerMinute("5")).toBe(5);
  });

  it.each([undefined, "", "0", "-1", "1.5", "many"])(
    "falls back to the default for %s",
    (value) => {
      expect(parseRequestsPerMinute(value)).toBe(DEFAULT_REQUESTS_PER_MINUTE);
    },
  );
});

describe("parseRequestsPerDay", () => {
  it("uses a valid positive integer", () => {
    expect(parseRequestsPerDay("600")).toBe(600);
  });

  it.each([undefined, "", "0", "-1", "1.5", "many"])(
    "falls back to the default for %s",
    (value) => {
      expect(parseRequestsPerDay(value)).toBe(DEFAULT_REQUESTS_PER_DAY);
    },
  );
});
