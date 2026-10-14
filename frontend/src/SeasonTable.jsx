import React, { useMemo, useState } from "react";
import ProjectionTierBoard from "./ProjectionTierBoard";
import {usePlayerCardOptional} from "./PlayerCardContext";
import {BOARD_COPY, projectionNumber, positionShort} from "./projectionsPresentation";
import {projectionValue, remainingGameProjection} from "./projectionTiers";
import {
  fmtNum,
  rosGamesPlayed,
  rosNextWeekP50,
  rosPPG,
  rosP50,
  rosRegPts,
  rosSeasonP50,
  rosSeasonP90,
} from "./format";
import {
  ExportCsvButton,
  useTableSort,
  useRankMap,
  rowRankKey,
  csvQuote,
  downloadCsv,
} from "./table";
import useMobileLayout from "./useMobileLayout";
import { usePlayerMedia } from "./PlayerCell";

function exportCsv(rows, seasonComplete) {
  const baseHeader = ["Player", "Team", "Reg pts", "G", "PPG"];
  const rosHeader = ["Weeks Left", "Next Wk P50", "ROS P50", "Season P50", "Season P90"];
  const header = seasonComplete ? baseHeader : [...baseHeader, ...rosHeader];

  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const base = [
        csvQuote(row.Player),
        row.Team || "",
        fmtNum(rosRegPts(row), 1, ""),
        rosGamesPlayed(row) ?? "",
        fmtNum(rosPPG(row), 1, ""),
      ];
      if (seasonComplete) return base.join(",");
      return [
        ...base,
        row["Weeks Remaining"] ?? "",
        fmtNum(rosNextWeekP50(row), 1, ""),
        fmtNum(rosP50(row), 1, ""),
        fmtNum(rosSeasonP50(row), 1, ""),
        fmtNum(rosSeasonP90(row), 1, ""),
      ].join(",");
    }),
  ];

  downloadCsv("scoresense-season", lines);
}

function sortValue(row, key) {
  switch (key) {
    case "Player":
      return String(row.Player || "");
    case "Team":
      return String(row.Team || "");
    case "RegPts":
      return Number(rosRegPts(row)) || 0;
    case "G":
      return Number(rosGamesPlayed(row)) || 0;
    case "PPG":
      return Number(rosPPG(row)) || 0;
    case "Left":
      return Number(row["Games Remaining"]) || 0;
    case "NextP50":
      return Number(rosNextWeekP50(row)) || 0;
    case "RosP50":
      return Number(rosP50(row)) || 0;
    case "SeasonP50":
      return Number(rosSeasonP50(row)) || 0;
    case "SeasonP90":
      return Number(rosSeasonP90(row)) || 0;
    case "Narrative":
      return Number(row.sentiment?.mention_count) || 0;
    default:
      return 0;
  }
}

// Number(null) === 0; coerce missing metrics to NaN so useRankMap leaves them unranked.
const knownPPG = row => {
  const points=projectionValue(rosRegPts(row)), games=projectionValue(rosGamesPlayed(row));
  return points!=null&&games!=null&&games>0?points/games:null;
};
const rankByRecorded = row => projectionValue(rosRegPts(row)) ?? NaN;
const rankByRos = row => projectionValue(rosP50(row)) ?? NaN;

export default function SeasonTable({
  rows,
  seasonComplete,
  projectionWeek,
  search,
  searchSlot,
  metaLine,
  loading = false,
  showSentiment = false,
  position,
  season,
  week,
  onClearFilters,
}) {
  const [seasonView,setSeasonView] = useState("ros");
  const recordedView = Boolean(seasonComplete) || seasonView === "recorded";
  const [sort, toggleSort] = useTableSort({column:seasonComplete?"RegPts":"RosP50",dir:"desc"});
  const mobileLayout = useMobileLayout();
  const playerCard = usePlayerCardOptional();

  // Position rank uses the full slate for the selected recorded or remaining view.
  const rankMap = useRankMap(rows, recordedView ? rankByRecorded : rankByRos);

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          String(r.Player || "").toLowerCase().includes(q) ||
          String(r.Team || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, search]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.column);
      const bv = sortValue(b, sort.column);
      if (sort.column === "Player" || sort.column === "Team") {
        return dir * String(av).localeCompare(String(bv));
      }
      return dir * (av - bv);
    });
  }, [filtered, sort]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  const hasFilters = Boolean((search || "").trim());

  return (
    <>
      <div className="table-controls">
        {!seasonComplete&&<div className="projection-season-tabs" role="group" aria-label={BOARD_COPY.seasonView}>
          {[['ros',BOARD_COPY.rosProjection],['recorded',BOARD_COPY.seasonSoFar]].map(([id,label])=><button key={id} type="button"
            aria-pressed={seasonView===id} onClick={()=>{setSeasonView(id);toggleSort(id==="ros"?"RosP50":"RegPts",{forceDir:"desc"});}}>{label}</button>)}
        </div>}
        {searchSlot}
        {!mobileLayout && (
          <ExportCsvButton onExport={() => exportCsv(sorted, seasonComplete)} disabled={!sorted.length} />
        )}
      </div>
      <div className="table-toolbar">
        <span className="table-meta">{sorted.length} players</span>
        {metaLine}
      </div>
      <ProjectionTierBoard rows={sorted} media={playerMedia} loading={loading}
        tierBasis={recordedView?BOARD_COPY.finalTierBasis:BOARD_COPY.rosTierBasis}
        sort={sort} onSort={toggleSort} emptyMessage="No players match your filters."
        onClearFilters={hasFilters?onClearFilters:undefined}
        getTierValue={row => recordedView?knownPPG(row):remainingGameProjection(row,rosP50(row))}
        columns={recordedView?[
          {key:"games",label:BOARD_COPY.games,sortKey:"G",digits:0},
          {key:"ppg",label:BOARD_COPY.ppg,sortKey:"PPG"},
          {key:"recorded",label:BOARD_COPY.recordedPoints,sortKey:"RegPts"},
        ]:[
          {key:"recorded",label:BOARD_COPY.recordedPoints,sortKey:"RegPts"},
          {key:"ppg",label:BOARD_COPY.ppg,sortKey:"PPG"},
          {key:"remaining",label:BOARD_COPY.gamesLeft,sortKey:"Left",digits:0},
          {key:"ros",label:BOARD_COPY.rosProjection,sortKey:"RosP50"},
        ]}
        getView={row => {
          const ppg=knownPPG(row);
          return {rank:rankMap.get(rowRankKey(row)),meta:[row.Team,positionShort(position)].filter(Boolean).join(" · "),
            values:{recorded:rosRegPts(row),games:rosGamesPlayed(row),ppg,remaining:row["Games Remaining"],ros:rosP50(row)},
            sub:recordedView?(ppg==null?null:`${projectionNumber(ppg)} PPG`):`${projectionNumber(remainingGameProjection(row,rosP50(row)))} /gm`};
        }}
        onOpen={row => {
          if(!row.player_id||!playerCard)return;
          playerCard.openPlayerCard({playerId:row.player_id,name:row.Player,team:row.Team,position,season,
            week:week??projectionWeek,scope:"season",seasonMode:"live",rank:rankMap.get(rowRankKey(row))??null});
        }}/>
    </>
  );
}
