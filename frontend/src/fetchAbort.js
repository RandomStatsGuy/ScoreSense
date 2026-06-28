/** True when fetch was cancelled via AbortController (ignore in catch blocks). */
export function isAbortError(error) {
  return error?.name === "AbortError";
}
