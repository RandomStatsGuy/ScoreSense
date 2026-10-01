import React, { useEffect, useState } from "react";
import { PAINT_WIDTH, teamLogoUrl } from "./draftMedia";

export default function NflTeamMark({ team }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team]);
  if (!team) return null;
  const logo = teamLogoUrl(team, { width: PAINT_WIDTH.avatar });
  return logo && !failed
    ? <img className="gc-nfl-team-mark" src={logo} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className="gc-nfl-team-mark gc-nfl-team-mark--fallback" aria-hidden="true">{team}</span>;
}
