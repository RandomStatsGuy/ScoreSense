import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { isAbortError } from "../fetchAbort";

const TeamIdentityContext = createContext({
  identities: {},
  catalog: null,
  reload: () => {},
});

export function useTeamIdentities() {
  return useContext(TeamIdentityContext);
}

export function TeamIdentityProvider({ leagueId, children }) {
  const [identities, setIdentities] = useState({});
  const [catalog, setCatalog] = useState(null);

  const load = useCallback(async (signal) => {
    if (!leagueId) {
      setIdentities({});
      return;
    }
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/identities`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (signal?.aborted) return;
      setIdentities(data.identities || {});
      setCatalog(data.catalog || null);
    } catch (e) {
      if (!isAbortError(e)) setIdentities({});
    }
  }, [leagueId]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const value = useMemo(
    () => ({
      identities,
      catalog,
      setIdentities,
      reload: () => load(),
    }),
    [identities, catalog, load],
  );

  return (
    <TeamIdentityContext.Provider value={value}>
      {children}
    </TeamIdentityContext.Provider>
  );
}

export function identityFor(identities, team) {
  if (!team) return null;
  return identities?.[team.id] || team.identity || null;
}
