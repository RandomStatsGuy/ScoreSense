import test from "node:test";
import assert from "node:assert/strict";
import { lockModalBackground } from "./modalBackground.js";

function page(overflow = "") {
  const doc = { body: { children: [], style: { overflow } } };
  const append = (inert = false) => {
    const root = { ownerDocument: doc, inert, contains(other) { return other === this; } };
    doc.body.children.push(root);
    return root;
  };
  return { doc, append };
}

test("a modal blocks the background and restores the original scroll state", () => {
  const { doc, append } = page("auto"), app = append(), dialog = append();
  const lock = lockModalBackground(dialog);
  assert.equal(app.inert, true); assert.equal(dialog.inert, false);
  assert.equal(doc.body.style.overflow, "hidden"); assert.equal(lock.isTop(), true);
  lock.release();
  assert.equal(app.inert, false); assert.equal(doc.body.style.overflow, "auto");
});

test("closing a nested confirmation reactivates its editor, keeping the page blocked", () => {
  const { doc, append } = page(), app = append(), editor = append();
  const first = lockModalBackground(editor), confirmation = append();
  const second = lockModalBackground(confirmation);
  assert.equal(first.isTop(), false); assert.equal(editor.inert, true);
  second.release();
  assert.equal(first.isTop(), true); assert.equal(editor.inert, false);
  assert.equal(app.inert, true); assert.equal(doc.body.style.overflow, "hidden");
  first.release(); assert.equal(app.inert, false); assert.equal(doc.body.style.overflow, "");
});

test("unmounting the editor before its confirmation does not strand the page inert", () => {
  const { doc, append } = page(), app = append(), editor = append();
  const first = lockModalBackground(editor), second = lockModalBackground(append());
  first.release();
  assert.equal(app.inert, true); assert.equal(second.isTop(), true);
  second.release();
  assert.equal(app.inert, false); assert.equal(doc.body.style.overflow, "");
});

test("three layers can close out of order and preserve pre-existing inert elements", () => {
  const { doc, append } = page("scroll"), app = append(), hidden = append(true);
  const first = lockModalBackground(append()), second = lockModalBackground(append()), third = lockModalBackground(append());
  second.release(); first.release();
  assert.equal(third.isTop(), true); assert.equal(app.inert, true);
  third.release();
  assert.equal(app.inert, false); assert.equal(hidden.inert, true);
  assert.equal(doc.body.style.overflow, "scroll");
});

test("release is idempotent and a new modal captures the fresh page state", () => {
  const { doc, append } = page(), app = append(), first = lockModalBackground(append());
  first.release(); doc.body.style.overflow = "auto";
  const second = lockModalBackground(append()); first.release();
  assert.equal(app.inert, true); assert.equal(second.isTop(), true);
  second.release(); assert.equal(app.inert, false); assert.equal(doc.body.style.overflow, "auto");
});

test("independent documents keep independent modal ownership", () => {
  const a = page(), b = page(), appA = a.append(), appB = b.append();
  const first = lockModalBackground(a.append()), second = lockModalBackground(b.append());
  first.release(); assert.equal(appA.inert, false); assert.equal(appB.inert, true);
  second.release(); assert.equal(appB.inert, false);
});
