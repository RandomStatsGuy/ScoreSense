import test from "node:test";
import assert from "node:assert/strict";
import {
  formatInjuryPollCadence,
  injuryRefreshFeedback,
  parseInjuryRefreshPayload,
} from "./injuryRefresh.js";

test("parseInjuryRefreshPayload extracts snapshot + rate-limit fields", () => {
  const parsed = parseInjuryRefreshPayload({
    allowed: false,
    status: "rate_limited",
    retry_after_seconds: 120.4,
    http_status_hint: 429,
    message: "Manual refresh rate-limited; serving current snapshot",
    poll: { phase: "inseason", cadence_seconds: 2700 },
    injuries: { count: 1, players: [{ full_name: "A" }] },
  });
  assert.equal(parsed.allowed, false);
  assert.equal(parsed.retryAfterSeconds, 120);
  assert.equal(parsed.players.length, 1);
  assert.equal(parsed.poll.phase, "inseason");
  assert.equal(parsed.httpStatusHint, 429);
});

test("injuryRefreshFeedback prefers retry wait when limited", () => {
  assert.match(
    injuryRefreshFeedback({
      allowed: false,
      retryAfterSeconds: 90,
      message: "limited",
    }),
    /rate-limited/i,
  );
  assert.match(
    injuryRefreshFeedback({ allowed: true, message: "Refresh queued; serving current snapshot" }),
    /queued/i,
  );
});

test("formatInjuryPollCadence summarizes phase + interval", () => {
  assert.equal(
    formatInjuryPollCadence({ phase: "reporting", cadence_seconds: 480 }),
    "Poll · reporting · every 8m",
  );
  assert.equal(
    formatInjuryPollCadence({ phase: "offseason", cadence_seconds: 10800 }),
    "Poll · offseason · every 3h",
  );
  assert.equal(formatInjuryPollCadence(null), null);
});
