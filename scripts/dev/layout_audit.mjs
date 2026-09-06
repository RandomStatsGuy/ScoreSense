#!/usr/bin/env node
/**
 * Falsifiable layout craft checks for ScoreSense screens.
 *
 *   node scripts/dev/layout_audit.mjs <route> [--width 1280|390] [--json] [--gate type,selects]
 *   node scripts/dev/layout_audit.mjs --all [--width 1280] [--json] [--gate type,selects,collisions,grids]
 *
 * Requires a running app at http://127.0.0.1:5173 and Playwright
 * (`cd frontend && npm install` after playwright is in package.json).
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.LAYOUT_AUDIT_BASE || "http://127.0.0.1:5173";

export const NUMERIC_RE = /^[$\-−+]?\s*[\d,.]+(?:st|nd|rd|th|pts?|yds?|%)?$/i;
const SINGLE_GLYPH_RE = /^[A-Z]{1,3}$|^[QDP]$|^[·•—–-]$/;
export const BAR_CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='radio'], [role='combobox']";
export const TABLE_DEAD_ZONE_PX = 32;
export const COLUMN_PACK_RATIO = 1.5;
export const GUTTER_EDGE_SELECTORS = [
  "[class*='hero']",
  ".hub-league-strip, .league-overflow-lead, .hub-league-bar",
  ".hub-experience-layout, .hub-home-club, .hub-table-card, .hub-experience-section, .hub-section",
];

export function parseGate(value) {
  if (value == null) return null;
  const rules = String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return rules.length ? rules : null;
}

export function isGatedFailure(result, gate) {
  if (!result || result.ok) return false;
  if (result.rule === "load") return true;
  if (!gate || !gate.length) return true;
  return gate.includes(result.rule);
}

export function auditFailed(report, gate) {
  return (report || []).some((row) => (row.results || []).some((x) => isGatedFailure(x, gate)));
}

export function parseArgs(argv) {
  const args = { route: null, width: 1280, json: false, all: false, gate: null };
  const rest = [...argv];
  while (rest.length) {
    const tok = rest.shift();
    if (tok === "--json") args.json = true;
    else if (tok === "--all") args.all = true;
    else if (tok === "--width") args.width = Number(rest.shift());
    else if (tok.startsWith("--width=")) args.width = Number(tok.slice(8));
    else if (tok === "--gate") args.gate = parseGate(rest.shift());
    else if (tok.startsWith("--gate=")) args.gate = parseGate(tok.slice(7));
    else if (!tok.startsWith("-") && !args.route) args.route = tok;
  }
  if (![1280, 390].includes(args.width)) {
    args.width = args.width <= 500 ? 390 : 1280;
  }
  return args;
}

/** HTML and SVG both expose a string class list this way. `el.className` is an object on SVG. */
export function elementClassName(el) {
  if (!el) return "";
  if (typeof el.getAttribute === "function") {
    const named = el.getAttribute("class");
    if (named != null) return String(named);
  }
  const raw = el.className;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw.baseVal === "string") return raw.baseVal;
  return "";
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

export function isBlockDisplay(display) {
  const base = String(display || "").split(" ")[0];
  return ["block", "flex", "grid", "list-item", "flow-root", "table"].includes(base);
}

export function isInFlowPosition(position) {
  return !["fixed", "absolute", "sticky"].includes(String(position || ""));
}

export function isAutoFillGridTemplate(specified) {
  return /auto-(fill|fit)/i.test(String(specified || ""));
}

export function minTargetForWidth(width) {
  return Number(width) === 390 ? 44 : 32;
}

export function isNumericCellText(text) {
  const line = String(text || "").split("\n")[0].replace(/\s+/g, " ").trim();
  return NUMERIC_RE.test(line);
}

export function tableWidthDeadZone(tableWidth, cardClientWidth, padL = 0, padR = 0) {
  return cardClientWidth - padL - padR - tableWidth;
}

export function pickBarControl(el) {
  if (!el) return null;
  if (typeof el.matches === "function" && el.matches(".hub-filter-menu-trigger, [role='combobox']")) return el;
  if (typeof el.matches === "function" && el.matches(BAR_CONTROL_SELECTOR)) return el;
  if (typeof el.querySelector === "function") {
    const trigger = el.querySelector(".hub-filter-menu-trigger, [role='combobox']");
    if (trigger) return trigger;
    return el.querySelector(BAR_CONTROL_SELECTOR);
  }
  return null;
}

export function isVisibleNativeSelect(box) {
  const width = Number(box?.width) || 0;
  const height = Number(box?.height) || 0;
  const display = String(box?.display || "");
  const visibility = String(box?.visibility || "");
  return width > 0 && height > 0 && display !== "none" && visibility !== "hidden";
}

export function columnAlign(texts) {
  const cells = texts.map((t) => String(t || "").split("\n")[0].trim()).filter((t) => t && t !== "—");
  if (!cells.length) return "left";
  if (cells.every((t) => SINGLE_GLYPH_RE.test(t))) return "center";
  const numeric = cells.filter((t) => isNumericCellText(t));
  return numeric.length / cells.length >= 0.8 ? "right" : "left";
}

export function remainderColumnIndex(aligns) {
  return (aligns || []).findIndex((align) => align === "left");
}

export function columnIsOverwide(colWidth, maxContentWidth, remainder, ratio = COLUMN_PACK_RATIO) {
  if (remainder) return false;
  if (!(maxContentWidth > 0) || !(colWidth > 0)) return false;
  return colWidth > maxContentWidth * ratio + 1;
}

export function isCssGridTableRowGroup(columnCounts, autoFillFlags = []) {
  if (!columnCounts || columnCounts.length < 2) return false;
  if (autoFillFlags.some(Boolean)) return false;
  const count = columnCounts[0];
  return count >= 3 && columnCounts.every((n) => n === count);
}

async function loadSurfaces() {
  const href = pathToFileURL(path.join(ROOT, "frontend/src/livingSurfaces.js")).href;
  const mod = await import(href);
  return livingSurfaceRoutes(mod.LIVING_SURFACES);
}

async function importPlaywright() {
  const candidates = [
    pathToFileURL(path.join(ROOT, "frontend/node_modules/playwright/index.mjs")).href,
    pathToFileURL(path.join(ROOT, "node_modules/playwright/index.mjs")).href,
    "playwright",
  ];
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      if (mod.chromium) return mod;
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

function measureScript() {
  return ({ minTarget, numericRe, barControlSelector, tableDeadZonePx, columnPackRatio, gutterSelectors }) => {
    const elementClassName = (el) => {
      if (!el) return "";
      if (typeof el.getAttribute === "function") {
        const named = el.getAttribute("class");
        if (named != null) return String(named);
      }
      const raw = el.className;
      if (typeof raw === "string") return raw;
      if (raw && typeof raw.baseVal === "string") return raw.baseVal;
      return "";
    };
    const results = [];
    const px = (n) => Math.round(n);
    const numericPat = new RegExp(numericRe, "i");

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
      const controlHeights = kids
        .map((c) => {
          const trigger = c.matches(".hub-filter-menu-trigger, [role='combobox']")
            ? c
            : c.querySelector(".hub-filter-menu-trigger, [role='combobox']");
          const inner = trigger || (c.matches(barControlSelector) ? c : c.querySelector(barControlSelector));
          return inner ? inner.offsetHeight : 0;
        })
        .filter((h) => h > 0);
      if (controlHeights.length > 1 && controlHeights.some((h) => Math.abs(h - controlHeights[0]) > 2)) {
        results.push({
          rule: "bars",
          ok: false,
          selector: `${el.className || el.tagName} controls`,
          detail: `control heights ${controlHeights.join(",")}`,
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

    // Block-level siblings only. Inline runs in one paragraph (Now $114 leftover)
    // are supposed to sit adjacent — do not compare every text node on the page.
    const isBlockDisplay = (display) => {
      const base = String(display || "").split(" ")[0];
      return ["block", "flex", "grid", "list-item", "flow-root", "table"].includes(base);
    };
    const blockKids = new Map();
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (!isBlockDisplay(cs.display)) return;
      if (["fixed", "absolute", "sticky"].includes(cs.position)) return;
      if (el.closest("script, style, .sr-only, [hidden]")) return;
      if (!(el.textContent || "").trim()) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const parent = el.parentElement;
      if (!parent) return;
      if (!blockKids.has(parent)) blockKids.set(parent, []);
      blockKids.get(parent).push({
        el,
        r,
        text: (el.textContent || "").trim().slice(0, 40),
      });
    });
    let collisions = 0;
    blockKids.forEach((siblings) => {
      for (let i = 0; i < siblings.length; i += 1) {
        for (let j = i + 1; j < siblings.length; j += 1) {
          const a = siblings[i].r;
          const b = siblings[j].r;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) {
            collisions += 1;
            if (collisions <= 5) {
              results.push({
                rule: "collisions",
                ok: false,
                selector: siblings[i].el.className || siblings[i].el.tagName,
                detail: `"${siblings[i].text}" overlaps "${siblings[j].text}"`,
              });
            }
          }
        }
      }
    });
    if (!results.some((r) => r.rule === "collisions" && !r.ok)) {
      results.push({ rule: "collisions", ok: true, selector: "", detail: "no overlapping block siblings" });
    }

    const firstLine = (t) => String(t || "").split("\n")[0].replace(/\s+/g, " ").trim();
    const isNumeric = (t) => numericPat.test(firstLine(t));
    const cellContentWidth = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      let width = 0;
      [...range.getClientRects()].forEach((rect) => { width = Math.max(width, rect.width); });
      [...el.children].forEach((child) => { width = Math.max(width, child.offsetWidth); });
      return width;
    };
    const rowCells = (row) => {
      if (row.cells) return [...row.cells];
      const named = [...row.children].filter((child) => {
        const role = child.getAttribute("role");
        return role === "cell" || role === "columnheader" || role === "gridcell" || role === "rowheader";
      });
      if (named.length) return named;
      return [...row.children].filter((child) => getComputedStyle(child).display !== "none");
    };
    const htmlTables = [...document.querySelectorAll("table")].map((table) => ({
      el: table,
      rows: [...table.rows],
      label: "table",
    }));
    const roleTables = [...document.querySelectorAll("[role='table'], [role='grid']")].map((table) => ({
      el: table,
      rows: [...table.querySelectorAll("[role='row']")],
      label: table.getAttribute("role") || "role-table",
    }));
    const gridTables = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.matches("table, [role='table'], [role='grid']")) return;
      const tableLike = /table|grid/i.test(elementClassName(el)) || el.getAttribute("role") === "table";
      if (!tableLike) return;
      const kids = [...el.children].filter((child) => {
        const cs = getComputedStyle(child);
        return cs.display !== "none" && child.offsetHeight > 0;
      });
      const gridKids = kids.filter((child) => getComputedStyle(child).display === "grid");
      if (gridKids.length < 2) return;
      const counts = gridKids.map((child) => getComputedStyle(child).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
      const autoFill = gridKids.map((child) => /auto-(fill|fit)/i.test(getComputedStyle(child).gridTemplateColumns));
      if (autoFill.some(Boolean)) return;
      if (counts[0] < 3 || counts.some((n) => n !== counts[0])) return;
      gridTables.push({
        el,
        rows: gridKids,
        label: "css-grid",
      });
    });
    const tables = [...htmlTables, ...roleTables, ...gridTables];
    tables.forEach((table, ti) => {
      const rows = table.rows.filter((row) => rowCells(row).length);
      if (!rows.length) return;
      const colCount = Math.max(...rows.map((row) => rowCells(row).length));
      const expectAligns = [];
      for (let c = 0; c < colCount; c += 1) {
        const cells = rows.map((row) => rowCells(row)[c]).filter(Boolean);
        if (!cells.length) continue;
        const header = firstLine(cells[0]?.innerText || "");
        const bodyTexts = cells.slice(1).map((cell) => firstLine(cell.innerText));
        const glyph = bodyTexts.length && bodyTexts.every((t) => /^[A-Z]{1,3}$|^[QDP]$/.test(t));
        const action = /action/i.test(header) || /actions|contract/i.test(cells[0]?.className || "");
        const numeric = bodyTexts.filter((t) => t && isNumeric(t)).length;
        let expect = "left";
        if (glyph) expect = "center";
        else if (action || (bodyTexts.length && numeric / bodyTexts.length >= 0.8)) expect = "right";
        expectAligns[c] = expect;
        const mismatches = cells.filter((cell) => {
          const align = getComputedStyle(cell).textAlign;
          const resolved = align === "start" ? "left" : align === "end" ? "right" : align;
          return resolved !== expect;
        });
        if (mismatches.length) {
          results.push({
            rule: "tables",
            ok: false,
            selector: `${table.label}:${ti} col ${c}`,
            detail: `${mismatches.length} cells align≠${expect} header="${header.slice(0, 24)}"`,
          });
        }
        const colWidth = Math.max(...cells.map((cell) => cell.offsetWidth || 0));
        const maxContent = Math.max(...cells.map((cell) => cellContentWidth(cell)));
        const remainder = expectAligns.findIndex((align) => align === "left") === c;
        const packRatio = columnPackRatio || 1.5;
        if (!remainder && colWidth > maxContent * packRatio + 1) {
          results.push({
            rule: "tables",
            ok: false,
            selector: `${table.label}:${ti} col ${c}`,
            detail: `col ${c} ${px(colWidth)}px > ${packRatio}× content ${px(maxContent)}px header="${header.slice(0, 24)}"`,
          });
        }
      }
      const card = table.el.closest(".hub-table-card, .table-wrap, .hub-section, .proj-board-surface");
      if (card) {
        const style = getComputedStyle(card);
        const padL = parseFloat(style.paddingLeft) || 0;
        const padR = parseFloat(style.paddingRight) || 0;
        const available = card.clientWidth - padL - padR;
        const deadZone = available - table.el.offsetWidth;
        if (deadZone > tableDeadZonePx) {
          results.push({
            rule: "tables",
            ok: false,
            selector: `${table.label}:${ti}`,
            detail: `table ${table.el.offsetWidth}px leaves ${px(deadZone)}px dead zone (available ${px(available)}px)`,
          });
        }
      }
    });
    if (!results.some((r) => r.rule === "tables")) {
      results.push({ rule: "tables", ok: true, selector: "", detail: "no tables or all aligned" });
    }

    const isAutoFillGridTemplate = (specified) => /auto-(fill|fit)/i.test(String(specified || ""));
    const specifiedGridTemplate = (el) => {
      if (isAutoFillGridTemplate(el.style.gridTemplateColumns)) {
        return el.style.gridTemplateColumns;
      }
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules) {
            const nested = walk(rule.cssRules);
            if (nested) return nested;
          }
          if (!rule.style || !rule.selectorText) continue;
          const tmpl = rule.style.getPropertyValue("grid-template-columns");
          if (!isAutoFillGridTemplate(tmpl)) continue;
          try {
            if (el.matches(rule.selectorText)) return tmpl;
          } catch {
            /* invalid selector */
          }
        }
        return "";
      };
      for (const sheet of document.styleSheets) {
        try {
          const hit = walk(sheet.cssRules);
          if (hit) return hit;
        } catch {
          /* cross-origin */
        }
      }
      return "";
    };
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display !== "grid") return;
      if (!specifiedGridTemplate(el)) return;
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
      results.push({ rule: "grids", ok: true, selector: "", detail: "auto-fill card grids even or none" });
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

    const probe = document.createElement("span");
    probe.style.fontSize = "var(--text-xs)";
    probe.style.position = "absolute";
    probe.textContent = ".";
    document.body.appendChild(probe);
    const xsPx = parseFloat(getComputedStyle(probe).fontSize) || 0;
    probe.remove();
    if (xsPx + 0.05 < 12) {
      results.push({
        rule: "type",
        ok: false,
        selector: ":root --text-xs",
        detail: `--text-xs computes to ${xsPx.toFixed(2)}px < 12px`,
      });
    }
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

    const edges = (gutterSelectors || [])
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

    const selects = [...document.querySelectorAll("select")].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    }).length;
    results.push(
      selects
        ? { rule: "selects", ok: false, selector: "select", detail: `${selects} visible native select(s)` }
        : { rule: "selects", ok: true, selector: "", detail: "0 visible native selects" },
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
  await page.waitForTimeout(600);
  try {
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector("main#main-content")) &&
        !document.querySelector("[aria-busy='true'], .hub-loading-skeleton, .hub-insights-skeleton"),
      { timeout: 12000 },
    );
  } catch {
    /* skeletons may persist on empty/error; still measure */
  }
  await page.waitForTimeout(400);
  const minTarget = minTargetForWidth(width);
  const results = await page.evaluate(measureScript(), {
    minTarget,
    numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR,
    tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO,
    gutterSelectors: GUTTER_EDGE_SELECTORS,
  });
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
    console.error("usage: node scripts/dev/layout_audit.mjs <route|--all> [--width 1280|390] [--json] [--gate type,selects,...]");
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

  const failed = auditFailed(report, args.gate);
  const failCount = report.reduce((n, r) => n + r.results.filter((x) => isGatedFailure(x, args.gate)).length, 0);
  if (args.json) console.log(JSON.stringify({ ok: !failed, gate: args.gate, report }, null, 2));
  if (!args.json) {
    const scope = args.gate ? `gated ${args.gate.join(",")}` : "all rules";
    console.log(`\n${failed ? "FAIL" : "PASS"}  ${failCount} failing check(s) across ${report.length} route(s) (${scope})`);
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
