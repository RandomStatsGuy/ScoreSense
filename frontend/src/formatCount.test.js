import assert from "node:assert/strict";
import test from "node:test";
import { formatCount } from "./formatCount.js";

test("formatCount uses the singular at one", () => {
  assert.equal(formatCount(1, "manager"), "1 manager");
  assert.equal(formatCount(1, "seat"), "1 seat");
  assert.equal(formatCount(1, "team"), "1 team");
});

test("formatCount pluralizes above one and treats zero as plural", () => {
  assert.equal(formatCount(0, "manager"), "0 managers");
  assert.equal(formatCount(12, "seat"), "12 seats");
  assert.equal(formatCount(2, "team"), "2 teams");
});
