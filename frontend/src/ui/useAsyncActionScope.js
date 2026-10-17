import { useCallback, useEffect, useRef } from "react";

/** Capture an action's source; invalidate it after a context change or unmount. */
export default function useAsyncActionScope(scope) {
  const currentScope = useRef(scope);
  const generation = useRef(0);
  const mounted = useRef(true);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    generation.current += 1;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  return useCallback(() => {
    const started = generation.current;
    return () => mounted.current && generation.current === started;
  }, []);
}
