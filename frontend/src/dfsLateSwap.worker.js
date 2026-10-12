import { readLateSwapFile, lateSwapRequestVersion, sharedRequestBody, portableLateSwapPlan } from "./dfsLateSwap.js";
globalThis.onmessage = async ({ data }) => {
  try {
    const value = data.operation === "read" ? await (async () => {
      const value = readLateSwapFile(data.text, data.context); return { value, version: await lateSwapRequestVersion(value) };
    })() : data.operation === "body" ? sharedRequestBody(data.request) :
      data.operation === "download" ? JSON.stringify(portableLateSwapPlan(data.review), null, 2) :
        (() => { throw new Error("Unsupported late-swap task."); })();
    globalThis.postMessage({ ok: true, value });
  } catch (error) { globalThis.postMessage({ ok: false, error: error.message }); }
};
