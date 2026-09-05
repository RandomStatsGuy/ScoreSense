/**
 * Site hero/intro copy must name a decision and a cost — not a slogan.
 * Run with: node --test frontend/src/copyVoice.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ACCURACY_COPY } from "./accuracyPresentation.js";
import { AUTH_COPY } from "./authPresentation.js";
import { bestBallHeroCopy } from "./bestBallPresentation.js";
import { DFS_STEP_COPY, dfsHeroCopy, launchCopy } from "./dfsToolPresentation.js";
import { HOME_PAGE_COPY } from "./DraftHub/leagueHomePresentation.js";
import { capHeroCopy } from "./DraftHub/capPlannerPresentation.js";
import { DRAFT_ENTRY_COPY, draftLobbyHeroHeading } from "./DraftHub/leagueAccessCopy.js";
import { INSIGHTS_COPY } from "./DraftHub/insights/insightsPresentation.js";
import { ROSTERS_COPY } from "./DraftHub/leagueRostersPresentation.js";
import { TRADES_COPY } from "./DraftHub/leagueTradesPresentation.js";
import { RULES_COPY } from "./DraftHub/rulesPresentation.js";
import { STRATEGY_RANK_COPY } from "./DraftHub/strategyRankPresentation.js";
import { VIBE_COPY } from "./DraftHub/vibeRankingsPresentation.js";
import { weekHeroCopy } from "./DraftHub/weekBoard.js";
import { mockDraftHeroCopy } from "./DraftHub/mockDraftConfig.js";
import { SECTION_SUBTITLES } from "./appNavigation.js";

const SLOGAN = /stay ahead|smarter way|own the week|without the spreadsheet|like a real league|command center|phase-aware|draft lab|why trust|make the next decision count|see the next three seasons|the league so far|spend the cap|keep the upside|who feels startable|draft the gap|aura is in|fill the nine|here[’']s the field|operational workspace|star targets|kinds of pressure|move that matters/i;

function flatten(value) {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [];
}

test("page heroes name a decision, not a slogan", () => {
  const lines = [
    HOME_PAGE_COPY.heading,
    capHeroCopy().heading,
    capHeroCopy({ empty: true }).support,
    capHeroCopy({ preDraft: true }).support,
    DRAFT_ENTRY_COPY.heading,
    DRAFT_ENTRY_COPY.support,
    draftLobbyHeroHeading(),
    draftLobbyHeroHeading({ testMode: true }),
    INSIGHTS_COPY.overview.heading,
    INSIGHTS_COPY.spend.heading,
    INSIGHTS_COPY.scoring.heading,
    INSIGHTS_COPY.history.heading,
    ROSTERS_COPY.heading,
    ROSTERS_COPY.support,
    TRADES_COPY.purpose,
    RULES_COPY.heading,
    RULES_COPY.support,
    STRATEGY_RANK_COPY.heading,
    STRATEGY_RANK_COPY.support,
    VIBE_COPY.heading,
    VIBE_COPY.support,
    VIBE_COPY.deckDoneHeading,
    weekHeroCopy({ emptyRoster: true }).heading,
    weekHeroCopy({ decisionCount: 0 }).heading,
    weekHeroCopy({ decisionCount: 2 }).support,
    dfsHeroCopy({ isDfs: true }).heading,
    dfsHeroCopy({ isDfs: false }).heading,
    launchCopy({ isDfs: true, hasLineup: false }).title,
    bestBallHeroCopy().heading,
    bestBallHeroCopy().support,
    AUTH_COPY.login.heading,
    AUTH_COPY.login.support,
    AUTH_COPY.register.heading,
    mockDraftHeroCopy().heading,
    mockDraftHeroCopy().support,
    ACCURACY_COPY.heading,
    ACCURACY_COPY.lead,
    DFS_STEP_COPY.formatSupport,
    mockDraftHeroCopy().formatSupport,
    HOME_PAGE_COPY.loadingHeading,
    SECTION_SUBTITLES.hub.home,
    SECTION_SUBTITLES.hub.value,
    SECTION_SUBTITLES.hub.planner,
    SECTION_SUBTITLES.tools.dfs,
    SECTION_SUBTITLES.model,
  ];

  for (const line of lines) {
    assert.doesNotMatch(line, SLOGAN, line);
    assert.doesNotMatch(line, /Draft Hub|Submit|permission/i, line);
  }

  assert.match(capHeroCopy().heading, /afford|bid|cut/i);
  assert.match(weekHeroCopy({ decisionCount: 1 }).support, /leave those points|sit the wrong/i);
  assert.match(RULES_COPY.support, /old deals|strands/i);
  assert.match(dfsHeroCopy({ isDfs: true }).support, /leave salary|lose/i);
  assert.match(bestBallHeroCopy().support, /discount|reach/i);
  assert.doesNotMatch(bestBallHeroCopy().support, /until a real ADP/i);
});

test("nested presentation blobs stay off slogan phrases", () => {
  const blob = flatten({
    HOME_PAGE_COPY,
    INSIGHTS_COPY,
    VIBE_COPY,
    STRATEGY_RANK_COPY,
    RULES_COPY,
    ROSTERS_COPY,
    TRADES_COPY,
    DRAFT_ENTRY_COPY,
  }).join(" ");
  assert.doesNotMatch(blob, SLOGAN);
});
