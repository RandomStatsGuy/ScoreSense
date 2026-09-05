import assert from "node:assert/strict";
import test from "node:test";
import {
  allowOfficeNavigation,
  hasOfficeUnsaved,
  resetOfficeUnsavedGuard,
  setOfficeUnsavedGuard,
} from "./officeUnsavedGuard.js";

test("office unsaved guard blocks until confirm returns true", async () => {
  resetOfficeUnsavedGuard();
  assert.equal(hasOfficeUnsaved(), false);
  assert.equal(await allowOfficeNavigation(), true);

  setOfficeUnsavedGuard(true, async () => false);
  assert.equal(hasOfficeUnsaved(), true);
  assert.equal(await allowOfficeNavigation(), false);

  setOfficeUnsavedGuard(true, async () => true);
  assert.equal(await allowOfficeNavigation(), true);
  resetOfficeUnsavedGuard();
});
