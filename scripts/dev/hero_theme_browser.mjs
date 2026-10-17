// Check the painted shared/Rules heroes against every approved Appearance palette.
// Uses production styles, no app/API or preference writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);
const styles = (await Promise.all(["styles/tokens.css", "styles.css", "styles/product-hierarchy.css", "styles/product-rhythm.css", "styles/color-theme.css", "styles/appearance.css"].map(file => readFile(path.join(root, "frontend/src", file), "utf8")))).join("\n");
const out = path.join(root, "outputs/hero-theme-review");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const report = [];
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  for (const mode of ["dark", "light"]) for (const width of [1280, 390]) for (const theme of ["none", "cozy", "snow", "leaves", "footballs"]) {
    await page.setViewportSize({ width, height: 700 });
    await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
    await page.setContent(`<html data-theme="${mode}" data-experience-theme="${theme}"><head></head><body><main style="padding:16px"><h1>Hero palette review</h1><section class="hub-experience-hero"><h2>Fantasy</h2><p>Shared hero · selected palette</p></section><section class="hub-rules-hero"><h2>League rules</h2><p>Rules hero · selected palette</p></section><span id="palette-probe" style="background:var(--theme-surface,var(--bg-elevated))"></span></main></body></html>`);
    await page.addStyleTag({ content: styles });
    const colors = await page.evaluate(() => ({
      surface: getComputedStyle(document.querySelector("#palette-probe")).backgroundColor,
      heroes: [...document.querySelectorAll(".hub-experience-hero,.hub-rules-hero")].map(el => getComputedStyle(el).backgroundImage),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    assert.equal(colors.overflow, false, `${theme}/${mode}/${width} overflow`);
    for (const image of colors.heroes) {
      assert.notEqual(image, "none");
      if (theme !== "none" || mode === "light") {
        assert.ok(image.includes(colors.surface), `${theme}/${mode}/${width} hero omits active surface ${colors.surface}: ${image}`);
      }
    }
    report.push({ theme, mode, width, ...colors });
    await page.screenshot({ path: path.join(out, `${theme}-${mode}-${width}.png`) });
  }
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS: ${report.length} hero theme/width scenarios; shared and Rules heroes preserve the active palette`);
} finally { await browser.close(); }
