/**
 * Guard the static-import edges that used to fold DraftRoom / Vibes / DFS
 * into the main index chunk.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function src(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("heavy Fantasy and Tools screens load through React.lazy", () => {
  const app = src("App.jsx");
  const router = src("AppRouter.jsx");
  const hub = src("DraftHub/DraftHub.jsx");
  const lobby = src("DraftHub/LobbyJoinPage.jsx");
  const mock = src("DraftHub/MockDraftTool.jsx");
  const vibes = src("DraftHub/VibeRankings.jsx");
  const insights = src("DraftHub/LeagueInsights.jsx");

  assert.match(app, /lazy\(\(\) => import\("\.\/DraftHub\/DraftHub"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/LineupOptimizer"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/DraftHub\/MockDraftTool"\)\)/);
  assert.match(router, /lazy\(\(\) => import\("\.\/DraftHub\/LobbyJoinPage"\)\)/);
  assert.doesNotMatch(router, /import LobbyJoinPage from/);
  assert.match(hub, /lazy\(\(\) => import\("\.\/DraftRoom"\)\)/);
  assert.match(hub, /lazy\(\(\) => import\("\.\/VibeRankings"\)\)/);
  assert.match(hub, /lazy\(\(\) => import\("\.\/LeagueInsights"\)\)/);
  assert.match(lobby, /lazy\(\(\) => import\("\.\/DraftRoom"\)\)/);
  assert.doesNotMatch(lobby, /import DraftRoom from/);
  assert.match(mock, /lazy\(\(\) => import\("\.\/DraftRoom"\)\)/);
  assert.doesNotMatch(mock, /import DraftRoom from/);
  assert.match(vibes, /lazy\(\(\) => import\("\.\/VibeSwipeDeck"\)\)/);
  assert.doesNotMatch(vibes, /import VibeSwipeDeck from/);
  assert.match(insights, /lazy\(\(\) => import\("\.\/insights\/InsightsCharts"\)\)/);
});
