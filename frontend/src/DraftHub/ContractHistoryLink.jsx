import React from "react";

export default function ContractHistoryLink({
  playerId,
  playerName,
  onOpen,
  className = "btn-link btn-sm",
  children = "Contract history",
}) {
  if (!onOpen || !playerId) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onOpen({ playerId, playerName });
      }}
    >
      {children}
    </button>
  );
}
