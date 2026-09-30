import assert from "node:assert/strict";
import test from "node:test";
import { apiFetch } from "./auth.js";
import { hasPendingClientWrite } from "./clientActivity.js";

test("pending HTTP writes block recovery and release on errors without swallowing them", async () => {
  const previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage;
  globalThis.localStorage = {getItem:()=>null};
  let complete;
  globalThis.fetch = () => new Promise(resolve=>{complete=resolve;});
  try {
    const pending = apiFetch("/api/hub/league/fixture/lineup", {method:"PUT"});
    assert.equal(hasPendingClientWrite(),true);
    complete(new Response(null,{status:409}));
    assert.equal((await pending).status,409);
    assert.equal(hasPendingClientWrite(),false);
    const error = new Error("network");
    globalThis.fetch = async () => {throw error;};
    await assert.rejects(apiFetch("/api/hub/league/fixture/lineup",{method:"PUT"}), e=>e === error);
    assert.equal(hasPendingClientWrite(),false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
