// Bundle this checkout's production Home without changing the active dev server.
// All fixture requests are intercepted; this never reads or writes a real league.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild");
let compiled;

export async function attachHomeFixture(surface) {
  compiled ||= (async () => {
    const result = await build({
      entryPoints: {
        "fantasy-home": path.join(root, "frontend/test-fixtures/fantasy-home.jsx"),
        "fantasy-landing": path.join(root, "frontend/test-fixtures/fantasy-landing.jsx"),
        "mobile-home": path.join(root, "frontend/test-fixtures/mobile-home.jsx"),
      },
      bundle: true, resolveExtensions:[".js",".jsx",".json"], format: "esm", write: false,
      outdir: path.join(root, "outputs/fantasy-home-fixture"),
      publicPath: "/__home-fixture", external: ["/art/*"],
      loader: { ".png": "file", ".jpg": "file", ".jpeg": "file", ".webp": "file", ".svg": "file", ".woff2": "file" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env": '{"DEV":true,"PROD":false}' }, logLevel: "silent",
    });
    return {
      assets: new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents])),
      theme: await readFile(path.join(root, "frontend/public/theme-init.js"), "utf8"),
    };
  })();
  const { assets, theme } = await compiled;
  await surface.route("**/*", async route => {
    const url = new URL(route.request().url());
    const fixture = url.pathname.startsWith("/hub/") ? "fantasy-landing" : /^\/test-fixtures\/(fantasy-home|fantasy-landing|mobile-home)\.html$/.exec(url.pathname)?.[1];
    if (fixture) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated production Fantasy Home</title><script>${theme}</script><link rel="stylesheet" href="/__home-fixture/${fixture}.css"></head><body><div id="root"></div><script type="module" src="/__home-fixture/${fixture}.js"></script></body></html>` });
    const name = path.basename(url.pathname);
    if (url.pathname.startsWith("/__home-fixture/") && assets.has(name)) {
      const type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream";
      return route.fulfill({ contentType: type, body: Buffer.from(assets.get(name)) });
    }
    return route.fulfill({ status: 404, body: "Not part of the isolated Home fixture" });
  });
}
