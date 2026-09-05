import test from "node:test";
import assert from "node:assert/strict";
import { formatReturnEstimate, isLowInformationInjury, parseApiError } from "./format.js";

const HEURISTIC = {
  label: "2-6 weeks",
  weeks_min: 2,
  weeks_max: 6,
  confidence: "low",
  rationale: "Knee injury pattern",
  is_estimate: true,
};

test("isLowInformationInjury: bare knee omits estimate", () => {
  assert.equal(isLowInformationInjury({ injury_body_part: "Knee", injury_notes: "" }), true);
  assert.equal(isLowInformationInjury({ injury_body_part: "knee", injury_notes: null }), true);
});

test("isLowInformationInjury: undisclosed omits estimate", () => {
  assert.equal(
    isLowInformationInjury({ injury_body_part: "Undisclosed", injury_notes: "" }),
    true,
  );
  assert.equal(
    isLowInformationInjury({ injury_body_part: "", injury_notes: "Undisclosed" }),
    true,
  );
});

test("isLowInformationInjury: knee with specific notes still shows", () => {
  assert.equal(
    isLowInformationInjury({ injury_body_part: "Knee", injury_notes: "Sprain" }),
    false,
  );
  assert.equal(
    isLowInformationInjury({ injury_body_part: "Knee - ACL", injury_notes: "Surgery" }),
    false,
  );
});

test("isLowInformationInjury: specific body parts are not low-info", () => {
  assert.equal(isLowInformationInjury({ injury_body_part: "Ankle", injury_notes: "" }), false);
  assert.equal(isLowInformationInjury({ injury_body_part: "Hamstring", injury_notes: "" }), false);
});

test("formatReturnEstimate labels estimates and hides low-info", () => {
  const shown = formatReturnEstimate(HEURISTIC, {
    injury_body_part: "Ankle",
    injury_notes: "",
  });
  assert.ok(shown);
  assert.match(shown.text, /^Est\. return:/);
  assert.equal(shown.isEstimate, true);

  const hidden = formatReturnEstimate(HEURISTIC, {
    injury_body_part: "Knee",
    injury_notes: "",
  });
  assert.equal(hidden, null);
});

test("formatReturnEstimate hides Unknown labels", () => {
  assert.equal(
    formatReturnEstimate({ label: "Unknown", is_estimate: true }, null),
    null,
  );
});

test("parseApiError maps gateway timeouts instead of Request failed", async () => {
  const html = `<html>${"x".repeat(300)}</html>`;
  const msg = await parseApiError(new Response(html, { status: 504 }));
  assert.match(msg, /too long/i);
  assert.doesNotMatch(msg, /Recent mocks|League settings/i);
});

test("parseApiError maps empty 500 bodies", async () => {
  const msg = await parseApiError(new Response("", { status: 500 }));
  assert.match(msg, /failed to finish|Reload/i);
  assert.doesNotMatch(msg, /Recent mocks|League settings/i);
});
