import assert from "node:assert/strict";
import test from "node:test";
import { MY_TEAM_COPY } from "./rosterPresentation.js";

test("My team qualifies committed as the season year", () => {
  assert.equal(MY_TEAM_COPY.committedLabel(2026), "2026 committed");
  assert.doesNotMatch(MY_TEAM_COPY.committedLabel(2026), /current roster/i);
});
