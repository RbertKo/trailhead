/** Browser helper for the JSON API routes. Throws with the server's message. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        `The request failed with status ${response.status}.`,
    );
  }
  return payload as T;
}

/**
 * `useChat` surfaces a failed response's raw body as the error message, so pull
 * out the API error's message when the body is one of ours.
 */
export function readableChatError(error: Error): string {
  try {
    return JSON.parse(error.message)?.error?.message ?? error.message;
  } catch {
    return error.message;
  }
}
