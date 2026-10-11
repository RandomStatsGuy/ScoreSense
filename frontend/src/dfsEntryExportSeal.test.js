import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sealEntryExportArtifact, stableBuildKey } from "./dfsEntryExportSeal.js";

const fixture = () => ({ csv: '"Entry ID"\r\n"0001"\r\n', manifest: {
  schema: "scoresense_entry_export_v1", lifecycle: "csv_created", acceptance: "unconfirmed",
  assignments: [{ entryId: "0001", contestId: "0002", lineupIndex: 0 }],
} });
const template = () => ({ rows: [["Entry ID"], ["0001"]] });
const digest = text => createHash("sha256").update(text).digest("hex");

test("T25/T35 actual WebCrypto seals exact CSV bytes and normalized source without mutating inputs", async () => {
  const result = fixture(), source = template();
  const sealed = await sealEntryExportArtifact(result, source);
  assert.equal(sealed.manifest.hashes.output_csv_sha256, digest(result.csv));
  assert.equal(sealed.manifest.hashes.template_rows_sha256, digest(JSON.stringify(source.rows)));
  assert.match(sealed.manifest.hashes.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.match(sealed.manifest.exportVersion, /^entry:[a-f0-9]{64}$/);
  assert.equal(result.manifest.hashes, undefined);
  assert.deepEqual(await sealEntryExportArtifact(sealed, source), sealed);
});

test("T30 edit, source, CSV line ending and assignment changes each create a different sealed version", async () => {
  const first = await sealEntryExportArtifact(fixture(), template());
  for (const change of [
    (result, _source) => { result.csv = result.csv.replaceAll("\r\n", "\n"); },
    (_result, source) => { source.rows.push(["Untouched instruction"]); },
    (result, _source) => { result.manifest.assignments[0].lineupIndex = 1; },
  ]) {
    const result = fixture(), source = template(); change(result, source);
    assert.notEqual((await sealEntryExportArtifact(result, source)).manifest.exportVersion, first.manifest.exportVersion);
  }
});

test("T28 stable build keys ignore object property order and an existing key; preserve immutable content", async () => {
  const first = await stableBuildKey({ site: "draftkings", settings: { objective: "median", locked: ["0001"] }, lineups: [{ dfs_id: "0001" }] });
  const reordered = await stableBuildKey({ lineups: [{ dfs_id: "0001" }], settings: { locked: ["0001"], objective: "median" }, site: "draftkings", idempotency_key: "old" });
  assert.equal(first, reordered); assert.match(first, /^build:[a-f0-9]{64}$/);
  assert.notEqual(first, await stableBuildKey({ site: "draftkings", lineups: [{ dfs_id: "1" }] }));
  await assert.rejects(stableBuildKey({ settings: { value: NaN } }), /finite/);
});
