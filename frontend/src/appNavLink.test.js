import assert from "node:assert/strict";
import test from "node:test";
import { interceptAppNav, isModifiedClick } from "./appNavLink.js";

function fakeEvent(overrides = {}) {
  return {
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
}

test("unmodified left-click intercepts and navigates", () => {
  let went = false;
  const event = fakeEvent();
  assert.equal(interceptAppNav(event, () => { went = true; }), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(went, true);
});

test("modifier and middle clicks stay native so a new tab can open", () => {
  for (const overrides of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    let went = false;
    const event = fakeEvent(overrides);
    assert.equal(isModifiedClick(event), true);
    assert.equal(interceptAppNav(event, () => { went = true; }), false);
    assert.equal(event.defaultPrevented, false);
    assert.equal(went, false);
  }
});
