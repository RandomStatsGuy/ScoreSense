import React from "react";
import { useParams } from "react-router-dom";
import TeamRoom from "./TeamRoom";

export default function SharedTeamRoom() {
  const { token } = useParams();
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="team-room-heading">
        <a href="/hub/roster" rel="noreferrer">ScoreSense</a>
        <span>Shared team room</span>
      </header>
      <main id="main-content">
        <TeamRoom token={token} />
      </main>
    </div>
  );
}
