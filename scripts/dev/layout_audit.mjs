#!/usr/bin/env node
/**
 * Falsifiable layout craft checks for ScoreSense screens.
 *
 *   node scripts/dev/layout_audit.mjs <route> [--width 1280|390] [--json]
 *   node scripts/dev/layout_audit.mjs --all [--width 1280] [--json]
 *
 * Requires a running app at http://127.0.0.1:5173 and Playwright
 * (`cd frontend && npm install` after playwright is in package.json).
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.LAYOUT_AUDIT_BASE || "http://127.0.0.1:5173";

const NUMERIC_RE = /^[$\-−+]?\s*[\d,.]+%?$/;
const SINGLE_GLYPH_RE = /^[A-Z]{1,3}$|^[QDP]$|^[·•—–-]$/;

function parseArgs(argv) {
  const args = { route: null, width: 1280, json: false, all: false };
  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift();
    if (tok === "--json") args.json = true;
    else if (tok === "--all") args.all = true;
    else if (tok === "--width") args.width = Number(rest.shift());
    else if (tok.startsWith("--width=")) args.width = Number(tok.slice(8));
    else if (!tok.startsWith("-") && !args.route) args.route = tok;
  }
  if (![1280, 390].includes(args.width)) {
    args.width = args.width <= 500 ? 390 : 1280;
  }
  return args;
}

export function livingSurfaceRoutes(surfaces) {
  const seen = new Set();
  const rows = [];
  for (const [id, row] of Object.entries(surfaces)) {
    if (!row?.route || row.overlay) continue;
    if (seen.has(row.route)) continue;
    seen.add(row.route);
    rows.push({ id, route: row.route, label: row.label });
  }
  return rows;
}

export function columnAlign(texts) {
  const cells = texts.filter((t) => t && t !== "—");
  if (!cells.length) return "left";
  if (cells.every((t) => SINGLE_GLYPH_RE.test(t.trim()))) return "center";
  const numeric = cells.filter((t) => NUMERIC_RE.test(t.replace(/\s+/g, " ").trim()));
  return numeric.length / cells.length >= 0.8 ? "right" : "left";
}

async function loadSurfaces() {
  const href = pathToFileURL(path.join(ROOT, "frontend/src/livingSurfaces.js")).href;
  const mod = await import(href);
  return livingSurfaceRoutes(mod.LIVING_SURFACES);
}

async function importPlaywright() {
  const candidates = [
    path.join(ROOT, "frontend/node_modules/playwright/index.js"),
    path.join(ROOT, "node_modules/playwright/index.js"),
    "playwright",
  ];
  for (const spec of candidates) {
    try {
      return await import(spec);
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Playwright is not installed. From frontend/: npm install && npx playwright install chromium",
  );
}

function fail(rule, selector, detail) {
  return { rule, ok: false, selector, detail };
}

function pass(rule, detail = "") {
  return { rule, ok: true, selector: "", detail };
}

function measureScript(minTarget) {
  return ({ minTarget }) => {
    const results = [];
    const px = (n) => Math.round(n);

    const bars = document.querySelectorAll(".hub-page-sticky, .hub-toolbar, thead");
    bars.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const pt = parseFloat(cs.paddingTop) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      if (Math.abs(pt - pb) > 1) {
        results.push({
          rule: "bars",
          ok: false,
          selector: `${el.className || el.tagName}:nth(${i})`,
          detail: `paddingTop=${px(pt)} paddingBottom=${px(pb)}`,
        });
      }
      const kids = [...el.children].filter((c) => getComputedStyle(c).display !== "none");
      const heights = kids.map((c) => c.offsetHeight);
      if (heights.length > 1 && heights.some((h) => Math.abs(h - heights[0]) > 2)) {
        results.push({
          rule: "bars",
          ok: false,
          selector: `${el.className || el.tagName} children`,
          detail: `child heights ${heights.join(",")}`,
        });
      }
      kids.forEach((c) => {
        const kcs = getComputedStyle(c);
        const mt = parseFloat(kcs.marginTop) || 0;
        const mb = parseFloat(kcs.marginBottom) || 0;
        if (mt > 1 || mb > 1) {
          results.push({
            rule: "bars",
            ok: false,
            selector: c.className || c.tagName,
            detail: `marginTop=${px(mt)} marginBottom=${px(mb)} inside bar`,
          });
        }
      });
    });
    if (!results.some((r) => r.rule === "bars")) results.push({ rule: "bars", ok: true, selector: "", detail: `${bars.length} bars` });

    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const parent = node.parentElement;
      if (!parent || !parent.offsetParent && parent !== document.body) continue;
      const r = parent.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      textNodes.push({ parent, r, text: node.textContent.trim().slice(0, 40) });
    }
    let collisions = 0;
    for (let i = 0; i < textNodes.length; i += 1) {
      for (let j = i + 1; j < textNodes.length; j += 1) {
        if (textNodes[i].parent !== textNodes[j].parent) continue;
        const a = textNodes[i].r;
        const b = textNodes[j].r;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 0 && overlapY > 0) {
          collisions += 1;
          if (collisions <= 5) {
            results.push({
              rule: "collisions",
              ok: false,
              selector: textNodes[i].parent.className || textNodes[i].parent.tagName,
              detail: `"${textNodes[i].text}" overlaps "${textNodes[j].text}"`,
            });
          }
        }
      }
    }
    if (!results.some((r) => r.rule === "collisions" && !r.ok)) {
      results.push({ rule: "collisions", ok: true, selector: "", detail: "no overlapping sibling text" });
    }

    document.querySelectorAll("table").forEach((table, ti) => {
      const rows = [...table.rows];
      if (!rows.length) return;
      const colCount = Math.max(...rows.map((r) => r.cells.length));
      for (let c = 0; c < colCount; c += 1) {
        const cells = rows.map((r) => r.cells[c]).filter(Boolean);
        const texts = cells.map((cell) => cell.innerText.replace(/\s+/g, " ").trim());
        const bodyTexts = texts.slice(1);
        const numeric = bodyTexts.filter((t) => t && /^[$\-−+]?\s*[\d,.]+%?$/.test(t)).length;
        const glyph = bodyTexts.length && bodyTexts.every((t) => /^[A-Z]{1,3}$|^[QDP]$/.test(t));
        const expect = glyph ? "center" : bodyTexts.length && numeric / bodyTexts.length >= 0.8 ? "right" : "left";
        cells.forEach((cell) => {
          const align = getComputedStyle(cell).textAlign;
          const resolved = align === "start" ? "left" : align === "end" ? "right" : align;
          if (resolved !== expect) {
            results.push({
              rule: "tables",
              ok: false,
              selector: `table:${ti} col ${c} ${cell.tagName}`,
              detail: `align=${resolved} expected=${expect} sample="${cell.innerText.slice(0, 24)}"`,
            });
          }
        });
      }
      const card = table.closest(".hub-table-card, .table-wrap, .hub-section, .proj-board-surface");
      if (card && table.offsetWidth < card.clientWidth * 0.9) {
        results.push({
          rule: "tables",
          ok: false,
          selector: `table:${ti}`,
          detail: `table ${table.offsetWidth}px < 0.9× card ${card.clientWidth}px`,
        });
      }
    });
    if (!results.some((r) => r.rule === "tables")) {
      results.push({ rule: "tables", ok: true, selector: "", detail: "no tables or all aligned" });
    }

    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display !== "grid") return;
      const kids = [...el.children].filter((c) => c.offsetHeight > 0);
      if (kids.length < 2) return;
      const tops = new Map();
      kids.forEach((c) => {
        const t = Math.round(c.offsetTop);
        if (!tops.has(t)) tops.set(t, []);
        tops.get(t).push(c.offsetHeight);
      });
      tops.forEach((heights) => {
        if (heights.length > 1 && heights.some((h) => Math.abs(h - heights[0]) > 2)) {
          results.push({
            rule: "grids",
            ok: false,
            selector: el.className || el.tagName,
            detail: `row heights ${heights.join(",")}`,
          });
        }
      });
    });
    if (!results.some((r) => r.rule === "grids")) {
      results.push({ rule: "grids", ok: true, selector: "", detail: "grid rows even or single-row" });
    }

    const targets = document.querySelectorAll("button, a[role='button'], [role='radio'], [role='tab']");
    let targetFails = 0;
    targets.forEach((el) => {
      if (getComputedStyle(el).display === "none") return;
      if (el.offsetHeight > 0 && el.offsetHeight < minTarget) {
        targetFails += 1;
        if (targetFails <= 6) {
          results.push({
            rule: "targets",
            ok: false,
            selector: el.className || el.tagName,
            detail: `height=${el.offsetHeight} < ${minTarget}`,
          });
        }
      }
    });
    if (!results.some((r) => r.rule === "targets" && !r.ok)) {
      results.push({ rule: "targets", ok: true, selector: "", detail: `${targets.length} targets ≥ ${minTarget}` });
    }

    const primaries = [...document.querySelectorAll(".btn-primary, button.btn-primary")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    results.push(
      primaries.length > 1
        ? { rule: "primaries", ok: false, selector: ".btn-primary", detail: `${primaries.length} visible primaries` }
        : { rule: "primaries", ok: true, selector: "", detail: `${primaries.length} visible primary` },
    );

    const xs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-xs")) || 12;
    const xsPx = xs < 4 ? xs * 16 : xs;
    let typeFails = 0;
    document.querySelectorAll("body *").forEach((el) => {
      if (!el.childNodes.length) return;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size && size + 0.05 < xsPx) {
        typeFails += 1;
        if (typeFails <= 5) {
          results.push({
            rule: "type",
            ok: false,
            selector: el.className || el.tagName,
            detail: `font-size=${size.toFixed(2)}px < --text-xs ${xsPx}px`,
          });
        }
      }
    });
    if (!results.some((r) => r.rule === "type" && !r.ok)) {
      results.push({ rule: "type", ok: true, selector: "", detail: `≥ ${xsPx}px` });
    }

    const edges = ["[class*='hero']", ".hub-league-strip, .league-overflow-lead, .hub-league-bar", ".hub-table-card, .hub-experience-section, .hub-section", ".hub-experience-summary"]
      .map((sel) => document.querySelector(sel))
      .filter(Boolean)
      .map((el) => ({ sel: el.className, x: Math.round(el.getBoundingClientRect().left) }));
    if (edges.length >= 2 && edges.some((e) => Math.abs(e.x - edges[0].x) > 1)) {
      results.push({
        rule: "gutters",
        ok: false,
        selector: edges.map((e) => e.sel).join(" | "),
        detail: `x=${edges.map((e) => e.x).join(",")}`,
      });
    } else {
      results.push({ rule: "gutters", ok: true, selector: "", detail: edges.length ? `x=${edges[0].x}` : "no band set" });
    }

    const selects = document.querySelectorAll("select").length;
    results.push(
      selects
        ? { rule: "selects", ok: false, selector: "select", detail: `${selects} native select(s)` }
        : { rule: "selects", ok: true, selector: "", detail: "0 native selects" },
    );

    results.push(
      document.scrollWidth > window.innerWidth + 1
        ? { rule: "overflow", ok: false, selector: "document", detail: `scrollWidth=${document.scrollWidth} innerWidth=${window.innerWidth}` }
        : { rule: "overflow", ok: true, selector: "", detail: "no horizontal overflow" },
    );

    return results;
  };
}

async function auditRoute(browser, route, width) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
  const url = `${BASE}${route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch (err) {
    await page.close();
    return [{ rule: "load", ok: false, selector: route, detail: String(err).slice(0, 160) }];
  }
  await page.waitForTimeout(400);
  try {
    await page.waitForFunction(
      () => !document.querySelector("[aria-busy='true'], .hub-loading-skeleton, .hub-insights-skeleton"),
      { timeout: 8000 },
    );
  } catch {
    /* skeletons may persist on empty/error; still measure */
  }
  const minTarget = width === 390 ? 44 : 32;
  const results = await page.evaluate(measureScript(minTarget), { minTarget });
  await page.close();
  return results;
}

function printTable(route, width, results) {
  console.log(`\n${route} @ ${width}`);
  for (const row of results) {
    const mark = row.ok ? "PASS" : "FAIL";
    const extra = [row.selector, row.detail].filter(Boolean).join(" — ");
    console.log(`  ${mark.padEnd(4)}  ${row.rule.padEnd(11)}  ${extra}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let jobs = [];
  if (args.all) {
    jobs = (await loadSurfaces()).map((r) => r.route);
  } else if (args.route) {
    jobs = [args.route.startsWith("/") ? args.route : `/${args.route}`];
  } else {
    console.error("usage: node scripts/dev/layout_audit.mjs <route|--all> [--width 1280|390] [--json]");
    process.exit(2);
  }

  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const route of jobs) {
      const results = await auditRoute(browser, route, args.width);
      report.push({ route, width: args.width, results });
      if (!args.json) printTable(route, args.width, results);
    }
  } finally {
    await browser.close();
  }

  const failed = report.some((r) => r.results.some((x) => !x.ok));
  if (args.json) console.log(JSON.stringify({ ok: !failed, report }, null, 2));
  if (!args.json) {
    const failCount = report.reduce((n, r) => n + r.results.filter((x) => !x.ok).length, 0);
    console.log(`\n${failed ? "FAIL" : "PASS"}  ${failCount} failing check(s) across ${report.length} route(s)`);
  }
  process.exit(failed ? 1 : 0);
}

const launched = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (launched) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
