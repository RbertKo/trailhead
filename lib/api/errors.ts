import { MissingApiKeyError } from "@/lib/meta/config";

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

const UPSTREAM_ERRORS: Record<number, ApiError> = {
  401: {
    status: 502,
    code: "invalid_api_key",
    message: "The Meta Model API rejected the API key.",
  },
  402: {
    status: 502,
    code: "billing_required",
    message:
      "Meta Model API billing is not set up, or the balance has run out.",
  },
  403: {
    status: 502,
    code: "model_forbidden",
    message: "This API key cannot use the requested Meta model.",
  },
  404: {
    status: 502,
    code: "model_not_found",
    message: "The requested Meta model is not available to this account.",
  },
  413: {
    status: 413,
    code: "upstream_payload_too_large",
    message: "The input is too large for the Meta Model API.",
  },
  429: {
    status: 429,
    code: "upstream_rate_limited",
    message: "The Meta Model API rate limit was reached. Try again shortly.",
  },
};

const UNKNOWN_ERROR: ApiError = {
  status: 502,
  code: "upstream_error",
  message: "The Meta Model API request failed. Try again shortly.",
};

// The OpenAI SDK sets `status`, the AI SDK sets `statusCode`, and the AI SDK's
// RetryError wraps the original failure in `lastError`.
export function readUpstreamStatus(error: unknown, depth = 0): number | undefined {
  if (typeof error !== "object" || error === null || depth > 3) return undefined;

  const { status, statusCode, lastError, cause } = error as Record<
    string,
    unknown
  >;
  if (typeof status === "number") return status;
  if (typeof statusCode === "number") return statusCode;
  return (
    readUpstreamStatus(lastError, depth + 1) ??
    readUpstreamStatus(cause, depth + 1)
  );
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof MissingApiKeyError) {
    return {
      status: 503,
      code: "api_key_missing",
      message: "MODEL_API_KEY is not configured on the server.",
    };
  }

  const status = readUpstreamStatus(error);
  return (status !== undefined && UPSTREAM_ERRORS[status]) || UNKNOWN_ERROR;
}

/** Logs the failure and returns the message that is safe to show to clients. */
export function reportApiError(error: unknown): ApiError {
  const apiError = toApiError(error);
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[meta-api] ${apiError.code}: ${detail}`);
  return apiError;
}
