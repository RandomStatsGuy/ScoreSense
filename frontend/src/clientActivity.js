let writes = 0;
export function beginClientWrite() {
  writes += 1;
  let released = false;
  return () => { if (!released) { released = true; writes -= 1; } };
}
export function hasPendingClientWrite() { return writes > 0; }
