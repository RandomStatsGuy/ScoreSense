import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_COPY,
  adminLinkAccountRef,
  adminLinkSuccess,
  openAdminFranchises,
} from "./adminPresentation.js";

test("admin link copy tells staff what happens next", () => {
  assert.match(ADMIN_COPY.linkExisting.hint, /franchise|team/i);
  assert.match(ADMIN_COPY.linkExisting.action, /link/i);
  assert.doesNotMatch(ADMIN_COPY.linkExisting.action, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(ADMIN_COPY.linkExisting.hint, /Draft Hub/i);
});

test("admin link success names the account and franchise", () => {
  assert.equal(
    adminLinkSuccess({ email: "owner@mail.com", team: "Night Owls" }),
    "Linked owner@mail.com to Night Owls. They will see that team in Fantasy.",
  );
});

test("admin link accepts email or native user sub", () => {
  assert.deepEqual(adminLinkAccountRef("  owner@mail.com "), { email: "owner@mail.com" });
  assert.deepEqual(adminLinkAccountRef("ss:abc-123"), { user_sub: "ss:abc-123" });
  assert.deepEqual(adminLinkAccountRef(""), {});
});

test("open admin franchises hides claimed and bot seats", () => {
  const open = openAdminFranchises([
    { id: "a", name: "Open", user_sub: null },
    { id: "b", name: "Taken", user_sub: "ss:1" },
    { id: "c", name: "Bot", is_bot: true },
  ]);
  assert.deepEqual(open.map((t) => t.id), ["a"]);
});
