import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Stems where a .jsx component and a .js module differ only by case. */
function collidingStems() {
  const byLower = new Map();
  for (const file of FILES) {
    const key = file.replace(/\.(js|jsx)$/, "").toLowerCase();
    byLower.set(key, (byLower.get(key) || 0) + 1);
  }
  return new Set([...byLower.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/** `import Default from "./spec"` / `import Default, { x } from "./spec"`. */
const DEFAULT_IMPORT = /import\s+[A-Za-z_$][\w$]*\s*(?:,\s*\{[^}]*\})?\s*from\s*["'](\.[^"']+)["']/g;

test("default imports of case-colliding modules name an explicit extension", () => {
  const colliding = collidingStems();
  const violations = [];
  for (const file of FILES) {
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(DEFAULT_IMPORT)) {
      if (/\.(js|jsx|css|json)$/.test(spec)) continue;
      const stem = resolve(dirname(file), spec).toLowerCase();
      if (colliding.has(stem)) {
        violations.push(`${relative(SRC, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(violations.sort(), [], `ambiguous imports: ${violations.join(", ")}`);
});
