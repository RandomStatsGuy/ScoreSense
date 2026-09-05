import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const LeagueChromeContext = createContext({
  chrome: null,
  setChrome: () => {},
});

function attentionSig(items) {
  return (items || []).map((item) => `${item.id}:${item.label}:${item.actionLabel}`).join("|");
}

export function LeagueChromeProvider({ children }) {
  const [chrome, setChromeState] = useState(null);
  const setChrome = useCallback((next) => {
    setChromeState((prev) => {
      if (next == null) return null;
      if (
        prev
        && prev.leagueName === next.leagueName
        && prev.phaseLabel === next.phaseLabel
        && prev.roleLabel === next.roleLabel
        && attentionSig(prev.attentionItems) === attentionSig(next.attentionItems)
      ) {
        return prev;
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome, setChrome]);
  return (
    <LeagueChromeContext.Provider value={value}>
      {children}
    </LeagueChromeContext.Provider>
  );
}

export function useLeagueChrome() {
  return useContext(LeagueChromeContext);
}
