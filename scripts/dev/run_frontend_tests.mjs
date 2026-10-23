// Explicit paths work on both Windows and Unix; Node does not expand a directory
// argument such as "src" into test files on every supported runtime.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(file);
    return entry.isFile() && /\.test\.(?:js|jsx|mjs)$/.test(entry.name) ? [file] : [];
  });
}

const tests = collect(path.join(frontend, "src")).sort();
if (!tests.length) throw new Error("No frontend tests found");
tests.push(fileURLToPath(new URL("./layout_audit.test.mjs", import.meta.url)));
const child = spawn(process.execPath,
  ["--test", "--test-concurrency=4", ...process.argv.slice(2), ...tests],
  { cwd: frontend, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
