import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import {
  HubAlert,
  HubAlertStack,
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubFilterMenu,
  HubPage,
  HubPageSticky,
  HubLoadingSkeleton,
  HubTableCard,
} from "./DraftHub/HubUILayout";
import { usePageWindowedRows } from "./DraftHub/useWindowedRows";
import { ExportCsvButton, csvQuote, downloadCsv } from "./table";
import {
  BB_COL_COUNT,
  BB_COLUMNS,
  BB_COVERAGE_FILTERS,
  BB_NO_ECR_LABEL,
  BB_POSITION_FILTERS,
  bestBallBoardNote,
  bestBallSorts,
  bestBallCsvLines,
  bestBallEdgeLegendCopy,
  bestBallGroupLabel,
  bestBallHeroCopy,
  bestBallScoringNote,
  bestBallStatusChip,
  bestBallSummaryItems,
  buildBoardItems,
  byeLabel,
  edgeTone,
  filterBoardRows,
  formatEcr,
  formatEdge,
  formatRank,
  formatSeasonPoints,
  shouldGroupBoard,
  sortBoardRows,
} from "./bestBallPresentation";
import { displayNflTeam } from "./nflTeamAbbrev";

export default function BestBallBoard() {
  const [players, setPlayers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortId, setSortId] = useState("model");
  const [positionId, setPositionId] = useState("ALL");
  const [coverageId, setCoverageId] = useState("ALL");
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
    () => sortBoardRows(
      filterBoardRows(players, { position: positionId, search, coverage: coverageId }),
      sortId,
    ),
    [players, positionId, search, coverageId, sortId],
  );
  const items = useMemo(
    () => buildBoardItems(rows, { groupByPosition: shouldGroupBoard(sortId, positionId) }),
    [rows, sortId, positionId],
  );
  const windowed = !loading && items.length > 40;
  const { rootRef, range } = usePageWindowedRows(items.length, { enabled: windowed });
  const visibleItems = windowed ? items.slice(range.start, range.end) : items;
  const topPad = windowed ? range.start * 44 : 0;
  const bottomPad = windowed ? Math.max(0, items.length - range.end) * 44 : 0;

  const hero = bestBallHeroCopy();
  const chip = bestBallStatusChip({
    loading,
    count: players.length,
    withAdp: meta?.with_adp || 0,
  });
  const summaryItems = bestBallSummaryItems({
    count: players.length,
    withAdp: meta?.with_adp || 0,
  });
  const boardNote = bestBallBoardNote();
  const sortOptions = bestBallSorts({ ecrOnly: !meta?.with_adp, withAdp: meta?.with_adp || 0 });

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
            title="This board"
            subtitle="Rankings refresh with the season projection model."
            items={summaryItems}
            note={boardNote}
          />
        )}
      >
        <HubPageSticky>
          <div className="hub-filter-bar bestball-toolbar">
            <input
              type="search"
              className="search-input hub-filter-search"
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search best ball board"
            />
            <div className="hub-filter-bar-menus">
              <HubFilterMenu
                label="Pos"
                value={positionId}
                options={BB_POSITION_FILTERS}
                onChange={setPositionId}
              />
              <HubFilterMenu
                label="ECR"
                value={coverageId}
                options={BB_COVERAGE_FILTERS}
                onChange={setCoverageId}
              />
              <HubFilterMenu
                label="Sort"
                value={sortId}
                options={sortOptions}
                onChange={setSortId}
              />
            </div>
            <p className="bestball-scoring-note" title="ScoreSense season model is trained on PPR scoring">
              {bestBallScoringNote()}
            </p>
            <ExportCsvButton onExport={exportCsv} disabled={loading || rows.length === 0} />
          </div>
        </HubPageSticky>
        <p className="bestball-legend">{bestBallEdgeLegendCopy()}</p>

        <HubTableCard className="bestball-table">
          <div className="bestball-table-page" ref={rootRef}>
            <table>
              <thead>
                <tr>
                  {BB_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={col.id === "player" ? "bestball-col-player" : "num"}
                      title={col.hint}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={BB_COL_COUNT}>
                      <HubLoadingSkeleton label="Building the board" rows={8} />
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={BB_COL_COUNT} className="table-empty-state muted">
                      {error ? "The board could not load." : "No players match this filter."}
                    </td>
                  </tr>
                )}
                {!loading && topPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={BB_COL_COUNT} style={{ height: topPad, padding: 0, border: 0 }} />
                  </tr>
                )}
                {!loading &&
                  visibleItems.map((item) => {
                    if (item.type === "group") {
                      return (
                        <tr key={`group-${item.position}`} className="bestball-pos-group">
                          <th scope="rowgroup" colSpan={BB_COL_COUNT}>
                            {bestBallGroupLabel(item.position, item.count)}
                          </th>
                        </tr>
                      );
                    }
                    const row = item.row;
                    const ecrLabel = formatEcr(row.adp_rank);
                    const tone = edgeTone(row.value_vs_adp);
                    return (
                      <tr key={`${row.player_id || row.Player}-${row.Position}`}>
                        <td className="num">{item.index}</td>
                        <td className="bestball-col-player">{row.Player}</td>
                        <td className="num">{row.Position}</td>
                        <td className="num">{formatRank(row.model_rank)}</td>
                        <td className="num">{displayNflTeam(row.Team)}</td>
                        <td className="num muted">{byeLabel(row.bye_week)}</td>
                        <td className="num">{formatSeasonPoints(row["Season Proj"])}</td>
                        <td className="num">
                          {ecrLabel === BB_NO_ECR_LABEL ? (
                            <span className="bestball-no-ecr">{BB_NO_ECR_LABEL}</span>
                          ) : (
                            ecrLabel
                          )}
                        </td>
                        <td className={`num bestball-edge${tone ? ` is-${tone}` : ""}`}>
                          {ecrLabel === BB_NO_ECR_LABEL ? (
                            <span className="bestball-no-ecr">{BB_NO_ECR_LABEL}</span>
                          ) : (
                            formatEdge(row.value_vs_adp)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {!loading && bottomPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={BB_COL_COUNT} style={{ height: bottomPad, padding: 0, border: 0 }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </HubTableCard>
        <p className="sr-only">{PRODUCT_DISCLAIMER}</p>
      </HubExperienceLayout>
    </HubPage>
  );
}
