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
