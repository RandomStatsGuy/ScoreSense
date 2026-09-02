import test from "node:test";
import assert from "node:assert/strict";
import { withLocationSearch } from "./redirectSearch.js";

test("root redirects keep invite and claim query strings", () => {
  assert.equal(
    withLocationSearch("/projections/weekly", "?claim=abc", ""),
    "/projections/weekly?claim=abc",
  );
  assert.equal(
    withLocationSearch("/projections/weekly", "?invite=tok", "#hub"),
    "/projections/weekly?invite=tok#hub",
  );
  assert.equal(withLocationSearch("/hub/home", "", ""), "/hub/home");
});
