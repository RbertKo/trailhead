import { NextResponse, type NextRequest } from "next/server";

import {
  createRateLimiter,
  parseRequestsPerDay,
  parseRequestsPerMinute,
} from "@/lib/guard/rate-limit";

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

function tooManyRequests(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "rate_limited", message } },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Every /api route spends Meta credits, so the limit lives here where a new
// route cannot forget it.
export function proxy(request: NextRequest) {
  // Vercel overwrites this header, so clients cannot spoof it there. Behind any
  // other host, check that it is set by something trusted.
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

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

export const config = {
  matcher: "/api/:path*",
};
