import { parseScenarioJson, checkScenarioAdmission, sharedRequestBody, portableSharedReview } from "./dfsSharedOutcomes.js";
import { DFS_SHARED_OUTCOMES_COPY as C } from "./dfsToolPresentation.js";

globalThis.onmessage = ({ data }) => {
  try {
    const value = data.operation === "read" ? checkScenarioAdmission(parseScenarioJson(data.text), data.inputs) :
      data.operation === "body" ? sharedRequestBody(data.request) : data.operation === "preview-body" ?
        sharedRequestBody({ context: data.inputs.context, pool: data.inputs.pool, bank: checkScenarioAdmission(data.bank, data.inputs) }) :
      data.operation === "download" ? JSON.stringify(portableSharedReview(data.snapshot, data.preview, data.report), null, 2) : (() => { throw new Error(C.workerError); })();
    globalThis.postMessage({ ok: true, value });
  } catch (error) { globalThis.postMessage({ ok: false, error: error.message }); }
};
