// Isolated production draft components. Every request is fulfilled locally;
// an existing API/Vite server and real accounts are never contacted.
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild");
const directory = path.join(root, "outputs/draft-room-fixture");
const compiled=new Map();
export const draftFixtureUrl = "http://127.0.0.1:5173/test-fixtures/draft-room.html";
export async function attachDraftFixture(context, { fixture="draft-room" } = {}) {
  if (!["draft-room","draft-tools","navigation-accessibility","rules-state","roster-context","management-acquisition","office-acceptance"].includes(fixture)) throw new Error("Unknown draft fixture");
  const assets=fixture==="draft-room"?directory:path.join(directory,fixture);
  if (!compiled.has(fixture)) compiled.set(fixture,(async () => {
    await mkdir(assets, { recursive: true });
    await build({ entryPoints: { app: path.join(root, `frontend/test-fixtures/${fixture}.jsx`) },
      bundle: true, jsx: "automatic", resolveExtensions: [".js", ".jsx", ".json"], format: "esm", outdir: assets, entryNames: "[name]", external: ["/art/*"],
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff2": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"DEV":true,"PROD":false}' }, logLevel: "silent" });
    return readFile(path.join(root, "frontend/public/theme-init.js"), "utf8");
  })());
  const theme = await compiled.get(fixture);
  await context.route("http://127.0.0.1:5173/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/test-fixtures/${fixture}.html` || (["navigation-accessibility","rules-state","roster-context","management-acquisition","office-acceptance"].includes(fixture) && route.request().resourceType() === "document")) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>${theme}</script><link rel="stylesheet" href="/__draft-fixture/app.css"></head><body><div id="root"></div><script type="module" src="/__draft-fixture/app.js"></script></body></html>` });
    if (["/__draft-fixture/app.js", "/__draft-fixture/app.css"].includes(url.pathname))
      return route.fulfill({ contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/css", body: await readFile(path.join(assets, path.basename(url.pathname))) });
    if (url.pathname.startsWith("/art/") || url.pathname.startsWith("/fonts/")) {
      const publicRoot = path.join(root, "frontend/public"), file = path.resolve(publicRoot, "." + decodeURIComponent(url.pathname));
      if (file.startsWith(publicRoot + path.sep)) {
        try { return await route.fulfill({ body: await readFile(file), contentType: file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" }); } catch { /* fixture has no matching optional asset */ }
      }
    }
    return route.fulfill({ status: 404, body: "Not part of the isolated draft fixture" });
  });
}
