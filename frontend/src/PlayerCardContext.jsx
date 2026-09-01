import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import PlayerCardModal from "./PlayerCardModal";

const PlayerCardContext = createContext(null);

export function PlayerCardProvider({
  children,
  candidates = [],
  compareIds = [],
  onToggleCompare,
  maxCompare = 4,
  resetKey,
}) {
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
      applyInjuryAdjustments: params.applyInjuryAdjustments,
      rank: params.rank,
      preview: params.preview || null,
      boardKey: resetKey,
    });
  }, [resetKey]);

  const closePlayerCard = useCallback(() => setRequest(null), []);

  const activeRequest = request && request.boardKey === resetKey ? request : null;

  const value = useMemo(
    () => ({
      openPlayerCard,
      closePlayerCard,
      candidates,
      compareIds,
      onToggleCompare,
      maxCompare,
    }),
    [openPlayerCard, closePlayerCard, candidates, compareIds, onToggleCompare, maxCompare],
  );

  return (
    <PlayerCardContext.Provider value={value}>
      {children}
      <PlayerCardModal
        request={activeRequest}
        onClose={closePlayerCard}
        candidates={candidates}
        compareIds={compareIds}
        onToggleCompare={onToggleCompare}
        maxCompare={maxCompare}
        onSelectPlayer={openPlayerCard}
      />
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
