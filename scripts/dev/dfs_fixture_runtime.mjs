// Bundle the real workspace and serve it only through this browser's intercepted
// fixture requests. An unrelated Vite server may keep owning port 5173.
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild");
const directory = path.join(root, "outputs/dfs-rebuild-fixture");
let compiled;

export async function attachDfsFixture(context) {
  if (!compiled) compiled = (async () => {
    await mkdir(directory, { recursive: true });
    await build({ entryPoints: { app: path.join(root, "frontend/test-fixtures/dfs-portfolio.jsx"),
        "dfsPortfolioBackup.worker": path.join(root, "frontend/src/dfsPortfolioBackup.worker.js"),
        "dfsSharedOutcomes.worker": path.join(root, "frontend/src/dfsSharedOutcomes.worker.js"),
        "dfsContestResearch.worker": path.join(root, "frontend/src/dfsContestResearch.worker.js"),
        "dfsContestPortfolio.worker": path.join(root, "frontend/src/dfsContestPortfolio.worker.js") },
      bundle: true, format: "esm", outdir: directory, entryNames: "[name]", publicPath: "/__dfs-fixture",
      external: ["/art/*"],
      loader: { ".png": "file", ".jpg": "file", ".jpeg": "file", ".webp": "file", ".svg": "file", ".woff2": "file" },
      define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
    return readFile(path.join(root, "frontend/public/theme-init.js"), "utf8");
  })();
  const theme = await compiled;
  await context.route("http://127.0.0.1:5173/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/test-fixtures/dfs-portfolio.html") {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated production DFS fixture</title><script>${theme}</script><link rel="stylesheet" href="/__dfs-fixture/app.css"></head><body><div id="root"></div><script type="module" src="/__dfs-fixture/app.js"></script></body></html>` });
      return;
    }
    if (url.pathname.startsWith("/__dfs-fixture/")) {
      const name = path.basename(url.pathname);
      const type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream";
      try { await route.fulfill({ contentType: type, body: await readFile(path.join(directory, name)) }); }
      catch { await route.fulfill({ status: 404, body: "Unknown isolated fixture asset" }); }
      return;
    }
    // The fixture's fetch adapter handles every API call. Never reach another
    // checkout's server for a missing fixture response or authenticated data.
    await route.fulfill({ status: 404, body: "Not part of the isolated DFS fixture" });
  });
}
