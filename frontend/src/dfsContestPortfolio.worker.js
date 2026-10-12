import { contestPortfolioRequest, sharedRequestBody, portableContestPortfolio } from "./dfsContestPortfolio.js";
globalThis.onmessage = async ({ data }) => {
  try {
    const value = data.operation === "request" ? await contestPortfolioRequest(data.selected, data.chosen, data.settings) :
      data.operation === "body" ? sharedRequestBody(data.request) :
      data.operation === "download" ? JSON.stringify(portableContestPortfolio(data.review), null, 2) :
      (() => { throw new Error("Unsupported portfolio task."); })();
    globalThis.postMessage({ ok: true, value });
  } catch (error) { globalThis.postMessage({ ok: false, error: error.message }); }
};
