import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import {
  HubAlert,
  HubAlertStack,
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubFilterChip,
  HubPage,
  HubTableCard,
} from "./DraftHub/HubUILayout";
import { ExportCsvButton, csvQuote, downloadCsv } from "./table";
import {
  BB_POSITION_FILTERS,
  BB_SORTS,
  bestBallBoardNote,
  bestBallCsvLines,
  bestBallHeroCopy,
  bestBallStatusChip,
  bestBallSummaryItems,
  byeLabel,
  edgeTone,
  filterBoardRows,
  formatEdge,
  formatRank,
  formatSeasonPoints,
  sortBoardRows,
} from "./bestBallPresentation";

export default function BestBallBoard() {
  const [players, setPlayers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortId, setSortId] = useState("model");
  const [positionId, setPositionId] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch("/api/bestball/board");
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to build the board"));
        const data = await res.json();
        if (!cancelled) {
          setPlayers(data.players || []);
          setMeta(data.meta || null);
        }
      } catch (err) {
        if (!cancelled) setError(connectionErrorMessage(err, "Failed to build the board"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => sortBoardRows(filterBoardRows(players, { position: positionId, search }), sortId),
    [players, positionId, search, sortId]
  );

  const hero = bestBallHeroCopy();
  const chip = bestBallStatusChip({
    loading,
    count: players.length,
    withAdp: meta?.with_adp || 0,
  });
  const summaryItems = bestBallSummaryItems({
    season: meta?.season,
    count: players.length,
    withAdp: meta?.with_adp || 0,
    sortId,
    positionId,
    filteredCount: rows.length,
  });
  const boardNote = bestBallBoardNote({ withAdp: meta?.with_adp || 0, count: players.length });

  const exportCsv = () => {
    downloadCsv("scoresense-bestball", bestBallCsvLines(rows, csvQuote));
  };

  return (
    <HubPage className="hub-experience-page bestball-board">
      <HubExperienceHero
        eyebrow={hero.eyebrow}
        heading={hero.heading}
        support={hero.support}
        chip={chip.label}
        chipTone={chip.tone}
      />

      {error && (
        <HubAlertStack>
          <HubAlert variant="danger">{error}</HubAlert>
        </HubAlertStack>
      )}

      <HubExperienceLayout
        summary={(
          <HubExperienceSummary
            title="Board at a glance"
            subtitle="Rankings refresh with the season projection model."
            items={summaryItems}
            note={boardNote}
            action={(
              <ExportCsvButton onExport={exportCsv} disabled={loading || rows.length === 0} />
            )}
          />
        )}
      >
        <div className="bestball-toolbar">
          <input
            type="search"
            className="search-input"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search best ball board"
          />
          <div className="bestball-chip-row" role="group" aria-label="Position filter">
            {BB_POSITION_FILTERS.map((entry) => (
              <HubFilterChip
                key={entry.id}
                compact
                active={positionId === entry.id}
                onClick={() => setPositionId(entry.id)}
              >
                {entry.label}
              </HubFilterChip>
            ))}
          </div>
          <div className="bestball-chip-row" role="group" aria-label="Sort order">
            {BB_SORTS.map((entry) => (
              <HubFilterChip
                key={entry.id}
                compact
                active={sortId === entry.id}
                title={entry.hint}
                onClick={() => setSortId(entry.id)}
              >
                {entry.label}
              </HubFilterChip>
            ))}
          </div>
        </div>

        <HubTableCard className="bestball-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Model</th>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Team</th>
                  <th>Bye</th>
                  <th className="num">Season proj</th>
                  <th className="num">ADP</th>
                  <th className="num" title="ADP minus model rank — positive means the market lets him fall">
                    Edge
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="table-empty-state muted">
                      Building the board from season projections — first load can take a few seconds…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-empty-state muted">
                      {error ? "The board could not load." : "No players match this filter."}
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => {
                    const tone = edgeTone(row.value_vs_adp);
                    return (
                      <tr key={`${row.player_id || row.Player}-${row.Position}`}>
                        <td className="num">{formatRank(row.model_rank)}</td>
                        <td>{row.Player}</td>
                        <td>{row.Position}</td>
                        <td>{row.Team || "—"}</td>
                        <td className="muted">{byeLabel(row.bye_week)}</td>
                        <td className="num">{formatSeasonPoints(row["Season Proj"])}</td>
                        <td className="num muted">{formatRank(row.adp_rank)}</td>
                        <td className={`num bestball-edge${tone ? ` is-${tone}` : ""}`}>
                          {formatEdge(row.value_vs_adp)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </HubTableCard>
        <p className="sr-only">{PRODUCT_DISCLAIMER}</p>
      </HubExperienceLayout>
    </HubPage>
  );
}
