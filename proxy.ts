import { NextResponse, type NextRequest } from "next/server";

import {
  createRateLimiter,
  parseRequestsPerMinute,
} from "@/lib/guard/rate-limit";

const checkRateLimit = createRateLimiter({
  limit: parseRequestsPerMinute(process.env.API_RATE_LIMIT_PER_MINUTE),
  windowMs: 60_000,
});

// Every /api route spends Meta credits, so the limit lives here where a new
// route cannot forget it.
export function proxy(request: NextRequest) {
  // Vercel overwrites this header, so clients cannot spoof it there. Behind any
  // other host, check that it is set by something trusted.
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const { allowed, retryAfterSeconds } = checkRateLimit(clientIp);
  if (allowed) return NextResponse.next();

  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: "Too many requests. Try again shortly.",
      },
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export const config = {
  matcher: "/api/:path*",
};
