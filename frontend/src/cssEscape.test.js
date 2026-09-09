import assert from "node:assert/strict";
import test from "node:test";
import { escapePlayerIdSelector } from "./cssEscape.js";

test("escapePlayerIdSelector uses CSS.escape when present", () => {
  const prior = globalThis.CSS;
  globalThis.CSS = { escape: (value) => `esc(${value})` };
  try {
    assert.equal(escapePlayerIdSelector("4017"), "esc(4017)");
  } finally {
    if (prior === undefined) delete globalThis.CSS;
    else globalThis.CSS = prior;
  }
});

test("escapePlayerIdSelector falls back when CSS.escape is missing", () => {
  const prior = globalThis.CSS;
  delete globalThis.CSS;
  try {
    assert.equal(escapePlayerIdSelector("4017"), "4017");
  } finally {
    if (prior === undefined) delete globalThis.CSS;
    else globalThis.CSS = prior;
  }
});
