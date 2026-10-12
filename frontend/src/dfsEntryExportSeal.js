/** Browser-native content fingerprints; hashes identify bytes, never accounts. */
function canonicalJson(value) {
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Export inputs must contain finite numbers.");
    return item;
  });
  if (json === undefined) throw new Error("Export inputs must be JSON data.");
  const order = item => Array.isArray(item) ? item.map(order) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
  return JSON.stringify(order(JSON.parse(json)));
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot fingerprint export versions. Use a secure browser session and retry.");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** Repeated saves of the same immutable request reuse one account-scoped build. */
export async function stableBuildKey(payload) {
  const { idempotency_key: _existing, ...inputs } = payload;
  return `build:${await sha256(canonicalJson(inputs))}`;
}

/** Seal the normalized source rows, exact CSV bytes and immutable edit manifest. */
export async function sealEntryExportArtifact(result, template) {
  if (result?.manifest?.schema !== "scoresense_entry_export_v1" || typeof result.csv !== "string" || !Array.isArray(template?.rows))
    throw new Error("Validate the entry template and CSV before recording an export version.");
  const output = structuredClone(result);
  const { hashes: _priorHashes, exportVersion: _priorVersion, ...manifest } = output.manifest;
  const [templateHash, outputHash, manifestHash] = await Promise.all([
    sha256(canonicalJson(template.rows)), sha256(output.csv), sha256(canonicalJson(manifest)),
  ]);
  const hashes = { algorithm: "SHA-256", template_rows_sha256: templateHash,
    output_csv_sha256: outputHash, manifest_sha256: manifestHash };
  output.manifest = { ...manifest, hashes, exportVersion: `entry:${await sha256(canonicalJson(hashes))}` };
  return output;
}
