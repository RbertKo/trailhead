export const DEFAULT_REQUESTS_PER_MINUTE = 30;

const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function parseRequestsPerMinute(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REQUESTS_PER_MINUTE;
}

/**
 * Fixed-window limiter held in process memory. Each server instance counts on
 * its own, so this is a best-effort brake against accidental or casual credit
 * burn, not a hard quota.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const { limit, windowMs, now = Date.now } = options;
  const windows = new Map<string, { count: number; resetAt: number }>();

  function makeRoom(time: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= time) windows.delete(key);
    }
    if (windows.size >= MAX_TRACKED_KEYS) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
  }

  return function check(key: string): RateLimitDecision {
    const time = now();
    let window = windows.get(key);

    if (!window || window.resetAt <= time) {
      if (!window && windows.size >= MAX_TRACKED_KEYS) makeRoom(time);
      window = { count: 0, resetAt: time + windowMs };
      windows.set(key, window);
    }

    window.count += 1;
    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.ceil((window.resetAt - time) / 1000),
    };
  };
}
