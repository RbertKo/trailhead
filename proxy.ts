import { NextResponse, type NextRequest } from "next/server";

import {
  isValidSessionToken,
  readCredentials,
  SESSION_COOKIE,
} from "@/lib/guard/auth";
import {
  createRateLimiter,
  parseRequestsPerDay,
  parseRequestsPerMinute,
} from "@/lib/guard/rate-limit";

const SIGN_IN_PAGE = "/login";
const SIGN_IN_API = "/api/login";

const checkRateLimit = createRateLimiter({
  limit: parseRequestsPerMinute(process.env.API_RATE_LIMIT_PER_MINUTE),
  windowMs: 60_000,
});

// Anyone can reach a public demo and every request spends the same key's credits,
// so the total has a ceiling too, however many addresses the requests come from.
const checkDailyLimit = createRateLimiter({
  limit: parseRequestsPerDay(process.env.API_DAILY_REQUEST_LIMIT),
  windowMs: 24 * 60 * 60 * 1000,
});

// Password guesses spend no credits, so they count separately: they can't use up
// the day's requests, and they get a far lower rate than a learner's turns.
const checkSignInLimit = createRateLimiter({
  limit: 10,
  windowMs: 60_000,
});

function tooManyRequests(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "rate_limited", message } },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Every page and /api route comes through here, so a new one cannot forget to
// require sign-in, and every /api route spends Meta credits, so the limits live
// here too.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Vercel overwrites this header, so clients cannot spoof it there. Behind any
  // other host, check that it is set by something trusted.
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (pathname === SIGN_IN_API) {
    const attempts = checkSignInLimit(clientIp);
    return attempts.allowed
      ? NextResponse.next()
      : tooManyRequests(
          "Too many sign-in attempts. Try again shortly.",
          attempts.retryAfterSeconds,
        );
  }

  const signedIn = isValidSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    readCredentials(),
  );

  if (pathname === SIGN_IN_PAGE) {
    return signedIn
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  if (!signedIn) {
    return isApi
      ? NextResponse.json(
          {
            error: {
              code: "unauthorized",
              message: "Your sign-in has expired. Reload the page to sign in again.",
            },
          },
          { status: 401 },
        )
      : NextResponse.redirect(new URL(SIGN_IN_PAGE, request.url));
  }
  if (!isApi) return NextResponse.next();

  const client = checkRateLimit(clientIp);
  if (!client.allowed) {
    return tooManyRequests(
      "Too many requests. Try again shortly.",
      client.retryAfterSeconds,
    );
  }

  const daily = checkDailyLimit("everyone");
  if (!daily.allowed) {
    return tooManyRequests(
      "This demo has reached its daily limit. Try again tomorrow.",
      daily.retryAfterSeconds,
    );
  }

  return NextResponse.next();
}

// Everything except Next's own files and the tab icon, which the sign-in page needs.
export const config = {
  matcher: "/((?!_next/|icon\\.svg$).*)",
};
