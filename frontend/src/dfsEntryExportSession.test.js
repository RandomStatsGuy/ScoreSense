import assert from "node:assert/strict";
import test from "node:test";
import { createEntryExportSession } from "./dfsEntryExportSession.js";

// The session is not a serializer or an authorization service. Its synthetic
// input represents a successful converter result; integration must supply it.
const artifact = () => ({ csv: '"Entry ID"\r\n"0001"\r\n', lines: ['"Entry ID"', '"0001"'],
  filename: "draftkings-edit-entries", changed: 1,
  manifest: { schema: "scoresense_entry_export_v1", lifecycle: "csv_created", acceptance: "unconfirmed",
    assignments: [{ entryId: "0001", contestId: "0010", lineupIndex: 0 }] } });
const serverError = (status = 503) => Object.assign(new Error("Synthetic storage outage"), { status });

test("T28 a storage timeout retains exact local work and permits disclosed pending-sync download", async () => {
  let downloads = 0, attempts = 0, authorizations = 0;
  const input = artifact();
  const session = createEntryExportSession({ artifact: input, authorize: async () => { authorizations++; return true; },
    synchronize: async () => { if (++attempts === 1) throw serverError(); return { imported: 1 }; } });
  input.csv = "Changed after approval";
  const pending = await session.download(result => { downloads++; assert.equal(result.csv, artifact().csv); });
  assert.equal(pending.syncStatus, "pending"); assert.equal(pending.downloaded, true);
  assert.equal(pending.acceptance, "unconfirmed");
  assert.throws(() => { pending.artifact.manifest.assignments[0].entryId = "foreign"; }, TypeError);
  const retried = await session.retrySync();
  assert.equal(retried.syncStatus, "synced"); assert.equal(attempts, 2); assert.equal(downloads, 1);
  await session.retrySync();
  assert.equal(attempts, 2); assert.equal(authorizations, 3);
});

test("T28 unauthorized and rejected validation never become an allowed recovery", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    let downloads = 0;
    const session = createEntryExportSession({ artifact: artifact(), authorize: async () => true,
      synchronize: async () => { throw serverError(status); } });
    await assert.rejects(session.download(() => { downloads++; }), error => error.status === status);
    assert.equal(downloads, 0); assert.equal(session.snapshot().syncStatus, "blocked");
  }
  let syncs = 0;
  for (const authorize of [async () => false, async () => { throw serverError(401); }]) {
    const session = createEntryExportSession({ artifact: artifact(), authorize,
      synchronize: async () => { syncs++; } });
    await assert.rejects(session.download(() => assert.fail("No unauthorized file")));
  }
  assert.equal(syncs, 0);
});

test("T28 network errors allow local recovery; unknown errors stay blocked", async () => {
  for (const [error, allowed] of [[new TypeError("Failed to fetch"), true], [new Error("Unclassified failure"), false],
    [new TypeError("Cannot read properties of undefined"), false]]) {
    const session = createEntryExportSession({ artifact: artifact(), authorize: async () => true,
      synchronize: async () => { throw error; } });
    if (allowed) assert.equal((await session.download(() => {})).syncStatus, "pending");
    else await assert.rejects(session.download(() => assert.fail("No unclassified recovery")));
  }
});

test("T28 concurrent clicks coalesce; downloads after success do not resave history", async () => {
  let writes = 0, downloads = 0;
  const session = createEntryExportSession({ artifact: artifact(), authorize: async () => true,
    synchronize: async () => { writes++; return { imported: 1 }; } });
  const download = () => { downloads++; };
  await Promise.all([session.download(download), session.download(download)]);
  assert.equal(writes, 1); assert.equal(downloads, 1);
  await session.download(download);
  assert.equal(writes, 1); assert.equal(downloads, 2);
});

test("T28 failed download does not claim file creation or repeat a successful history write", async () => {
  let writes = 0;
  const session = createEntryExportSession({ artifact: artifact(), authorize: async () => true,
    synchronize: async () => { writes++; } });
  await assert.rejects(session.download(() => { throw new Error("Synthetic local download failure"); }));
  assert.equal(session.snapshot().downloaded, false);
  await session.download(() => {});
  assert.equal(writes, 1); assert.equal(session.snapshot().downloaded, true);
});

test("T28 explicit pending local recovery reauthorizes without waiting for another optional sync", async () => {
  let authorizations = 0, writes = 0, downloads = 0;
  const session = createEntryExportSession({ artifact: artifact(), authorize: async () => { authorizations++; return true; },
    synchronize: async () => { writes++; throw serverError(); } });
  await session.retrySync();
  assert.equal(session.snapshot().downloaded, false);
  assert.equal(session.snapshot().lifecycle, "csv_created");
  await session.download(() => { downloads++; }, { skipPendingSync: true });
  assert.equal(writes, 1); assert.equal(authorizations, 2); assert.equal(downloads, 1);
  assert.equal(session.snapshot().syncStatus, "pending");
});
