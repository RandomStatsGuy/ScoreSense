import { readContestFile, sharedRequestBody, portableContestReview } from "./dfsContestResearch.js";
globalThis.onmessage = ({ data }) => {
  try {
    const value = data.operation === "read" ? readContestFile(data.text, data.selected) :
      data.operation === "body" ? sharedRequestBody(data.request) :
      data.operation === "download" ? JSON.stringify(portableContestReview(data.review), null, 2) :
      (() => { throw new Error("Unsupported research task."); })();
    globalThis.postMessage({ ok: true, value });
  } catch (error) { globalThis.postMessage({ ok: false, error: error.message }); }
};
