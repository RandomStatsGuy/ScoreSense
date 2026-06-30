import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import PlayerCardModal from "./PlayerCardModal";

const PlayerCardContext = createContext(null);

export function PlayerCardProvider({ children }) {
  const [request, setRequest] = useState(null);

  const openPlayerCard = useCallback((params) => {
    if (!params?.playerId) return;
    setRequest({
      playerId: params.playerId,
      playerName: params.name || params.playerName,
      team: params.team,
      position: params.position,
      season: params.season,
      week: params.week,
      scope: params.scope || "weekly",
    });
  }, []);

  const closePlayerCard = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({ openPlayerCard, closePlayerCard }),
    [openPlayerCard, closePlayerCard],
  );

  return (
    <PlayerCardContext.Provider value={value}>
      {children}
      <PlayerCardModal request={request} onClose={closePlayerCard} />
    </PlayerCardContext.Provider>
  );
}

export function usePlayerCard() {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) {
    throw new Error("usePlayerCard must be used within PlayerCardProvider");
  }
  return ctx;
}

export function usePlayerCardOptional() {
  return useContext(PlayerCardContext);
}
