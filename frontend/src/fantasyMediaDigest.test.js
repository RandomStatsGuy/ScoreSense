import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fantasyMediaNarrative,
  pickFantasyMediaDigest,
  pickFantasyMediaDigestSource,
} from "./fantasyMediaDigest.js";

test("pickFantasyMediaDigest reads canonical field only", () => {
  assert.equal(
    pickFantasyMediaDigest({ fantasy_media_digest: "  Locked in.  " }),
    "Locked in.",
  );
  assert.equal(pickFantasyMediaDigest(null), "");
  assert.equal(pickFantasyMediaDigest({}), "");
});

test("pickFantasyMediaDigest ignores beat_digest and fantasy_digest aliases", () => {
  assert.equal(
    pickFantasyMediaDigest({
      beat_digest: "Team beat only",
      fantasy_digest: "Legacy alias",
      fantasy_media_digest: "",
    }),
    "",
  );
  assert.equal(
    pickFantasyMediaDigest({
      beat_digest: "Should not surface",
      fantasy_digest: "Should not surface",
    }),
    "",
  );
});

test("pickFantasyMediaDigestSource ignores beat alias", () => {
  assert.equal(
    pickFantasyMediaDigestSource({
      fantasy_media_digest_source: "llm",
      beat_digest_source: "extractive",
    }),
    "llm",
  );
  assert.equal(
    pickFantasyMediaDigestSource({ beat_digest_source: "extractive" }),
    undefined,
  );
});

test("fantasyMediaNarrative prefers digest then non-digest fallbacks", () => {
  assert.equal(
    fantasyMediaNarrative(
      { fantasy_media_digest: "Digest text", snippet: "Raw" },
      "Raw",
      "summary",
    ),
    "Digest text",
  );
  assert.equal(
    fantasyMediaNarrative(
      { beat_digest: "Beat only", snippet: "  Raw notes  " },
      "  Raw notes  ",
      "summary",
    ),
    "Raw notes",
  );
});
