// Maps raw fetch/network error text (which leaks implementation details like
// "Overpass" or "ECONNREFUSED") to a message a non-technical user can act on.
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";

  if (/overpass/i.test(raw)) {
    return "Location data temporarily unavailable";
  }
  if (name === "AbortError" || name === "TimeoutError" || /abort|timeout/i.test(raw)) {
    return "This is taking longer than usual — please wait or try again";
  }
  if (/econnrefused/i.test(raw)) {
    return "Service temporarily unavailable";
  }
  if (/fetch failed/i.test(raw)) {
    return "Connection issue — please try again";
  }
  return raw || "Something went wrong. Please try again.";
}
