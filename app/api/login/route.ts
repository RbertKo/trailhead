import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse, parseJsonBody } from "@/lib/api/http";
import {
  createSessionToken,
  credentialsMatch,
  readCredentials,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/guard/auth";

const MAX_BODY_BYTES = 4 * 1024;

const bodySchema = z.object({ email: z.string(), password: z.string() });

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, MAX_BODY_BYTES);
  if ("response" in body) return body.response;

  const credentials = readCredentials();
  if (!credentials) {
    return errorResponse({
      status: 503,
      code: "auth_not_configured",
      message: "AUTH_EMAIL and AUTH_PASSWORD are not configured on the server.",
    });
  }

  if (!credentialsMatch(body.data, credentials)) {
    return errorResponse({
      status: 401,
      code: "invalid_credentials",
      message: "The email or password is incorrect.",
    });
  }

  const response = NextResponse.json({ signedIn: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(credentials), {
    httpOnly: true,
    // Follows the request, because some browsers drop a Secure cookie from plain
    // http://localhost, which would make signing in look like it did nothing.
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
