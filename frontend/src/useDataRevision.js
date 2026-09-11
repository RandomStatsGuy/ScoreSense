import { useSyncExternalStore } from "react";
let revision = 0;
const listeners = new Set();
export function publishDataRevision() {
  revision += 1;
  for (const listener of listeners) listener();
}
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export default function useDataRevision() {
  return useSyncExternalStore(subscribe, () => revision, () => 0);
}
