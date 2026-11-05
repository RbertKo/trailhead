import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/login/route";
import { config, proxy } from "@/proxy";

import {
  createSessionToken,
  isValidSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./auth";

const ACCOUNT = { email: "learner@example.com", password: "correct horse" };
const VALID_SESSION = createSessionToken(ACCOUNT);

let addresses = 0;

/** A new address each time, so the per-address limits don't carry between tests. */
function freshIp() {
  addresses += 1;
  return `test-${addresses}`;
}

function get(path: string, session?: string, ip = freshIp()) {
  const headers = new Headers({ "x-forwarded-for": ip });
  if (session) headers.set("cookie", `${SESSION_COOKIE}=${session}`);
  return new NextRequest(`http://localhost${path}`, { headers });
}

function postLogin(body: unknown, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/login`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function passedThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1";
}

beforeEach(() => {
  vi.stubEnv("AUTH_EMAIL", ACCOUNT.email);
  vi.stubEnv("AUTH_PASSWORD", ACCOUNT.password);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it.each(["/", "/somewhere/else"])(
    "sends a signed-out visit to %s to the sign-in page",
    (path) => {
      const response = proxy(get(path));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost/login");
    },
  );

  it.each(["/api/turn", "/api/region", "/api/anything-new"])(
    "answers a signed-out call to %s with 401",
    async (path) => {
      const response = proxy(get(path));

      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("unauthorized");
    },
  );

  it("lets a signed-in learner through to pages and the API", () => {
    expect(passedThrough(proxy(get("/", VALID_SESSION)))).toBe(true);
    expect(passedThrough(proxy(get("/api/turn", VALID_SESSION)))).toBe(true);
  });

  it("shows the sign-in page only to someone signed out", () => {
    expect(passedThrough(proxy(get("/login")))).toBe(true);

    const response = proxy(get("/login", VALID_SESSION));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("treats a forged or expired session as signed out", () => {
    const forged = createSessionToken({ ...ACCOUNT, password: "a guess" });
    const expired = createSessionToken(
      ACCOUNT,
      Date.now() - SESSION_MAX_AGE_SECONDS * 1000 - 1,
    );

    for (const session of [forged, expired, "garbage"]) {
      expect(proxy(get("/api/turn", session)).status).toBe(401);
      expect(proxy(get("/", session)).status).toBe(307);
    }
  });

  it("keeps everyone out while the credentials are not configured", () => {
    vi.stubEnv("AUTH_PASSWORD", "");

    expect(proxy(get("/", VALID_SESSION)).status).toBe(307);
    expect(proxy(get("/api/turn", VALID_SESSION)).status).toBe(401);
    expect(passedThrough(proxy(get("/login", VALID_SESSION)))).toBe(true);
  });

  it("stops password guessing from one address, but not from another", () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(passedThrough(proxy(get("/api/login", undefined, ip)))).toBe(true);
    }

    const blocked = proxy(get("/api/login", undefined, ip));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    expect(passedThrough(proxy(get("/api/login")))).toBe(true);
  });

  it("spends the daily limit only on signed-in calls", async () => {
    vi.stubEnv("API_DAILY_REQUEST_LIMIT", "2");
    vi.resetModules();
    const fresh = await import("@/proxy");

    for (let index = 0; index < 5; index += 1) {
      expect(fresh.proxy(get("/api/turn")).status).toBe(401);
      expect(passedThrough(fresh.proxy(get("/api/login")))).toBe(true);
      expect(passedThrough(fresh.proxy(get("/", VALID_SESSION)))).toBe(true);
    }

    expect(passedThrough(fresh.proxy(get("/api/turn", VALID_SESSION)))).toBe(
      true,
    );
    expect(passedThrough(fresh.proxy(get("/api/region", VALID_SESSION)))).toBe(
      true,
    );
    expect(fresh.proxy(get("/api/turn", VALID_SESSION)).status).toBe(429);
  });

  it.each([
    "/",
    "/login",
    "/api/turn",
    "/api/region",
    "/api/login",
    "/api/anything-new",
    "/anything-new",
    "/icon.svg.secret",
  ])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/_next/static/chunks/app.js",
    "/_next/image?url=x",
    "/icon.svg",
    "/icon.svg?abc123",
  ])("leaves %s alone, because the sign-in page needs it", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

describe("POST /api/login", () => {
  it("starts a session for the right email and password", async () => {
    const response = await POST(postLogin(ACCOUNT));

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    const token = new RegExp(`^${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1];
    expect(isValidSessionToken(token, ACCOUNT)).toBe(true);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=lax/i);
    expect(cookie).toMatch(/; Path=\/(;|$)/i);
    expect(cookie).toContain(`; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it("marks the cookie Secure only over https", async () => {
    const overHttp = await POST(postLogin(ACCOUNT));
    const overHttps = await POST(postLogin(ACCOUNT, "https://example.com"));

    expect(overHttp.headers.get("set-cookie")).not.toMatch(/; Secure/i);
    expect(overHttps.headers.get("set-cookie")).toMatch(/; Secure/i);
  });

  it.each([
    [{ ...ACCOUNT, password: "wrong" }],
    [{ ...ACCOUNT, email: "other@example.com" }],
    [{ email: "", password: "" }],
  ])("refuses %j with no session", async (attempt) => {
    const response = await POST(postLogin(attempt));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid_credentials");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("says so when the server has no credentials, without a session", async () => {
    vi.stubEnv("AUTH_EMAIL", "");

    const response = await POST(postLogin(ACCOUNT));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("auth_not_configured");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["not json", "{}", '{"email":"a"}', '{"email":1,"password":2}'])(
    "rejects the invalid body %s",
    async (body) => {
      expect((await POST(postLogin(body))).status).toBe(400);
    },
  );

  it("rejects a body over the size limit", async () => {
    const response = await POST(
      postLogin({ ...ACCOUNT, password: "x".repeat(5000) }),
    );

    expect(response.status).toBe(413);
  });
});
