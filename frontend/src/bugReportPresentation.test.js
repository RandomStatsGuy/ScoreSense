import assert from "node:assert/strict";
import test from "node:test";
import {
  BUG_REPORT_COPY,
  inferReportArea,
  reportHref,
  reportSuccess,
  safeReportFrom,
} from "./bugReportPresentation.js";

test("report copy names the board and skips banned verbs", () => {
  assert.match(BUG_REPORT_COPY.heading, /broke/i);
  assert.match(BUG_REPORT_COPY.support, /pickup board/i);
  assert.match(BUG_REPORT_COPY.send, /Send to the board/);
  assert.doesNotMatch(BUG_REPORT_COPY.send, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(BUG_REPORT_COPY.needAccount, /Submit|Draft Hub|permission/i);
  assert.match(BUG_REPORT_COPY.accountLink, /pickup board/i);
});

test("inferReportArea maps in-app paths", () => {
  assert.equal(inferReportArea("/hub/setup"), "Fantasy");
  assert.equal(inferReportArea("/projections/weekly"), "Projections");
  assert.equal(inferReportArea("/tools/dfs"), "Tools");
  assert.equal(inferReportArea("/account"), "Account");
  assert.equal(inferReportArea("/login"), "Sign in");
  assert.equal(inferReportArea("/report"), "Other");
});

test("safeReportFrom keeps in-app pages and drops secrets", () => {
  assert.equal(safeReportFrom("/hub/setup?invite=secret"), "/hub/setup");
  assert.equal(safeReportFrom("https://evil.example/phish"), "");
  assert.equal(safeReportFrom("//evil.example"), "");
  assert.equal(reportHref("/hub/setup"), "/report?from=%2Fhub%2Fsetup");
});

test("success names the ticket key", () => {
  assert.match(reportSuccess("SCORE-99"), /SCORE-99/);
  assert.match(reportSuccess(""), /pickup board/);
  assert.doesNotMatch(reportSuccess("SCORE-99"), /Submit|Draft Hub/i);
});
