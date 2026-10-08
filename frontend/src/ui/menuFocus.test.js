import test from "node:test";
import assert from "node:assert/strict";
import { focusLeftMenu } from "./menuFocus.js";

function node(children = []) {
  const self = { children, contains: (other) => other === self || children.some((c) => c.contains(other)) };
  return self;
}

test("focus moving to another control closes the menu", () => {
  const menu = node();
  assert.equal(focusLeftMenu({ currentTarget: menu, relatedTarget: node() }), true);
});

test("focus moving inside the menu keeps it open", () => {
  const option = node();
  const menu = node([option]);
  assert.equal(focusLeftMenu({ currentTarget: menu, relatedTarget: option }), false);
});

test("Safari null relatedTarget keeps it open", () => {
  assert.equal(focusLeftMenu({ currentTarget: node(), relatedTarget: null }), false);
});

test("a press on menu padding that focuses <main> keeps it open", () => {
  const menu = node();
  const main = node([menu]);
  assert.equal(focusLeftMenu({ currentTarget: menu, relatedTarget: main }), false);
});
