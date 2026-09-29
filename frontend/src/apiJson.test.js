/**
 * Run with: node --test frontend/src/apiJson.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse } from "./apiJson.js";

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});
const htmlResponse = (status) => ({
  ok: status < 400,
  status,
  json: async () => {
    throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
  },
});

test("a JSON body comes back as data", async () => {
  assert.deepEqual(await readJsonResponse(jsonResponse({ contests: [] }), "/api/x"), {
    contests: [],
  });
});

test("an error with a detail reports the server's own words", async () => {
  await assert.rejects(
    readJsonResponse(jsonResponse({ detail: "Sign in to save your DFS results." }, { ok: false, status: 401 })),
    /Sign in to save your DFS results\./,
  );
  // An error shaped some other way still says something.
  await assert.rejects(
    readJsonResponse(jsonResponse({ detail: [{ msg: "bad" }] }, { ok: false, status: 422 })),
    /could not be completed/,
  );
  await assert.rejects(
    readJsonResponse(jsonResponse(null, { ok: false, status: 500 })),
    /could not be completed/,
  );
});

test("a page instead of data names the request and the status", async () => {
  // This is the failure a restarting API or a proxy error page produces. It
  // used to surface as "Unexpected token '<'", which named nothing.
  await assert.rejects(
    readJsonResponse(htmlResponse(502), "/api/lineup/slates?site=dk&category=showdown"),
    (error) => {
      assert.match(error.message, /\/api\/lineup\/slates/);
      assert.match(error.message, /502/);
      // The query string is noise in an error banner.
      assert.equal(error.message.includes("site=dk"), false);
      assert.equal(error.message.includes("Unexpected token"), false);
      return true;
    },
  );
  // A 200 that is not JSON is the same class of problem, not a success.
  await assert.rejects(readJsonResponse(htmlResponse(200), "/api/lineup/formats"), /200/);
});
