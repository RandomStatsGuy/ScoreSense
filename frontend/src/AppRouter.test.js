import test from "node:test";
import assert from "node:assert/strict";
import { joinLandingPath, withLocationSearch } from "./redirectSearch.js";

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

test("invite and claim links land on Draft", () => {
  assert.equal(joinLandingPath("?invite=tok"), "/hub/draft");
  assert.equal(joinLandingPath("?claim=abc"), "/hub/draft");
  assert.equal(joinLandingPath(""), "/projections/weekly");
  assert.equal(
    withLocationSearch(joinLandingPath("?invite=tok"), "?invite=tok", ""),
    "/hub/draft?invite=tok",
  );
});
