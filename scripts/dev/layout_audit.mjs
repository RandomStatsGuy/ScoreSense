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

export const NUMERIC_RE = /^[\-\u2212+]?\s*\$?\s*[\d,.]+(?:st|nd|rd|th|pts?|yds?|%)?$/i;
const SINGLE_GLYPH_RE = /^[A-Z]{1,3}$|^[QDP]$|^[·•—–-]$/;
export const BAR_CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='radio'], [role='combobox']";
export const TABLE_DEAD_ZONE_PX = 32;
export const COLUMN_PACK_RATIO = 1.5;
export const GUTTER_EDGE_SELECTORS = [
  "[class*='hero']:not([class*='mobile-player-card-hero'])",
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

/** Opening phone locker details must preserve the selected jersey's grid cell. */
export async function auditLockerStability(page) {
  if (page.viewportSize()?.width > 600) return [];
  const lockers = page.locator(".team-room-locker-trigger");
  if (await lockers.count() < 2) return [];
  const trigger = lockers.nth(1);
  if (!await trigger.isVisible() || !await trigger.isEnabled()) return [];
  await trigger.scrollIntoViewIfNeeded();
  const bounds = () => trigger.evaluate(el => {
    const box = el.getBoundingClientRect();
    return {x:box.x,y:box.y + scrollY,width:box.width,height:box.height};
  });
  const before = await bounds();
  await trigger.click();
  const after = await bounds();
  const ok = Object.keys(before).every(key => Math.abs(before[key] - after[key]) < 2);
  const close = page.locator(".team-room-drawer button[aria-label='Close locker']");
  if (await close.count()) await close.click();
  return [{rule:"lockers",ok,selector:".team-room-locker-trigger",detail:ok?"Right jersey stays in its grid cell":"Opening details moves or resizes the right jersey"}];
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

/** True when a later .draft-hub sibling will paint over an overflowing menu host. */
export function laterSiblingCoversMenuHost(hostZIndex, siblingZIndex) {
  const hostZ = Number.parseInt(hostZIndex, 10);
  const sibZ = Number.parseInt(siblingZIndex, 10);
  if (!Number.isFinite(hostZ)) return true;
  if (!Number.isFinite(sibZ)) return false;
  return sibZ >= hostZ;
}

export const DRAFT_HUB_MENU_HOST_SELECTOR = ".hub-league-context-bar";
export const DRAFT_HUB_STACK_EXCLUDE = /\b(hub-atmosphere|fantasy-chat-dock)\b/;

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

export function measureScript() {
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
    const tokenPixels = (name) => {
      const root = getComputedStyle(document.documentElement);
      const value = root.getPropertyValue(name).trim();
      const number = Number.parseFloat(value);
      if (value.endsWith("rem")) return number * Number.parseFloat(root.fontSize);
      return value.endsWith("px") ? number : Number.NaN;
    };
    const results = [];
    document.querySelectorAll(".hub-week-forecast-opponent, .hub-week-forecast-totals strong").forEach(el => {
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 || (cs.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 1);
      const faded = Number(cs.opacity) < 1 || (cs.maskImage && cs.maskImage !== "none");
      results.push({rule:"matchup-readability",ok:!clipped && !faded,selector:elementClassName(el),detail:clipped ? "banner name or total clipped" : faded ? "banner name or total faded" : "banner name and total readable"});
    });
    document.querySelectorAll(".companion-drag-area").forEach((area) => {
      const style = getComputedStyle(area);
      const hiddenGuide = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].every((width) => parseFloat(width) === 0)
        && ["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor)
        && style.backgroundImage === "none" && style.boxShadow === "none" && style.outlineStyle === "none";
      results.push({ rule: "companion-bounds", ok: hiddenGuide, selector: ".companion-drag-area", detail: hiddenGuide ? "movement bounds remain invisible" : "movement bounds draw a visible guide" });
    });
    // Wide screens exposed the old disconnected pile tiles. The shared scene
    // must have one continuous base, seated on its layout's bottom edge.
    document.querySelectorAll(".app-atmosphere-floor .companion-ground").forEach((ground) => {
      const floor = ground.closest(".app-atmosphere-floor");
      const base = ground.getBoundingClientRect(), bounds = floor.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(floor).paddingBottom) || 0;
      const continuous = Math.abs(base.left - bounds.left) <= 1 && Math.abs(base.right - bounds.right) <= 1 && Math.abs(base.bottom - (bounds.bottom - inset)) <= 1;
      results.push({ rule: "atmosphere-ground", ok: continuous, selector: ".companion-ground", detail: continuous ? "continuous base sits on the page ground" : "base has gaps, clipping, or floats above its layout edge" });
    });
    document.querySelectorAll(".companion-interaction").forEach((button) => {
      const rect = button.getBoundingClientRect();
      results.push({ rule: "companion-controls", ok: rect.width >= 44 && rect.height >= 44 && !button.closest('[aria-hidden="true"]'), selector: ".companion-interaction", detail: "toys have accessible targets of at least 44px" });
    });
    const px = (n) => Math.round(n);
    const numericPat = new RegExp(numericRe, "i");

    // Center standalone form columns, keep editable text aligned, and keep
    // consent controls beside the first line of their wrapping copy.
    const formVisible = (el) => {
      const box = el?.getBoundingClientRect();
      return box?.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    document.querySelectorAll(".standalone-content").forEach((panel) => {
      if (!panel.querySelector(".account-auth-form") || !formVisible(panel)) return;
      const column = panel.querySelector(".standalone-form-content");
      const bounds = panel.getBoundingClientRect(), box = column?.getBoundingClientRect();
      const probe = document.createElement("div");
      probe.style.width = "var(--form-content-max)";
      panel.appendChild(probe);
      const limit = probe.getBoundingClientRect().width;
      probe.remove();
      const ok = Boolean(box) && box.width <= limit + 1 && Math.abs(box.left + box.width / 2 - (bounds.left + bounds.width / 2)) <= 1;
      results.push({ rule: "form-columns", ok, selector: ".standalone-form-content", detail: ok ? "bounded column centered inside its card" : "form column is missing, too wide, or off center" });
    });
    document.querySelectorAll(".account-auth-form label:not(.legal-terms-checkbox)").forEach((label) => {
      const control = label.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea');
      if (!formVisible(control)) return;
      const box = label.getBoundingClientRect(), field = control.getBoundingClientRect();
      const ok = Math.abs(box.left - field.left) <= 1 && [label, control].every((el) => ["left", "start"].includes(getComputedStyle(el).textAlign));
      results.push({ rule: "form-labels", ok, selector: ".account-auth-form label", detail: ok ? "label and field share a left edge" : "label or field text is centered or misaligned" });
    });
    document.querySelectorAll('.account-auth-form input:not([type="checkbox"]):not([type="radio"]), .account-auth-form textarea, .hub-filter-menu--field .hub-filter-menu-trigger').forEach((control) => {
      if (!formVisible(control)) return;
      const ok = control.getBoundingClientRect().height >= minTarget;
      results.push({ rule: "form-controls", ok, selector: control.className || control.tagName, detail: ok ? "field uses the form control height" : "field is undersized or missing shared styling" });
    });
    document.querySelectorAll(".standalone-form-row").forEach((row) => {
      const controls = [...row.querySelectorAll("input, .hub-filter-menu-trigger")].filter(formVisible);
      const heights = controls.map(control => control.getBoundingClientRect().height);
      const ok = heights.every(height => Math.abs(height - heights[0]) <= 1);
      results.push({ rule: "form-controls", ok, selector: ".standalone-form-row", detail: ok ? "paired controls share one height" : `paired control heights: ${heights.map(height => height.toFixed(1)).join(", ")}` });
    });
    document.querySelectorAll(".account-auth-form .legal-terms-checkbox").forEach((label) => {
      const checkbox = label.querySelector('input[type="checkbox"]'), copy = label.querySelector("span");
      if (!formVisible(checkbox) || !formVisible(copy)) return;
      const check = checkbox.getBoundingClientRect(), text = copy.getBoundingClientRect();
      const ok = text.left > check.right && Math.abs(text.top - check.top) <= 4;
      results.push({ rule: "consent-rows", ok, selector: ".legal-terms-checkbox", detail: ok ? "checkbox beside the first line of consent" : "checkbox is stacked above, overlaps, or drifts below its consent" });
    });
    document.querySelectorAll(".standalone-page-footer, .standalone-content .auth-panel-back-desktop").forEach((footer) => {
      if (!formVisible(footer)) return;
      const bounds = footer.getBoundingClientRect();
      const ok = [...footer.children].filter(formVisible).every((el) => {
        const box = el.getBoundingClientRect();
        return Math.abs(box.left + box.width / 2 - (bounds.left + bounds.width / 2)) <= 1;
      });
      results.push({ rule: "form-footers", ok, selector: footer.className, detail: ok ? "footer navigation is centered" : "footer navigation is off center" });
    });
    document.querySelectorAll(".sms-opt-in-card").forEach((form) => {
      const group = form.querySelector(".sms-opt-in-disclosures");
      const ok = Boolean(group) && parseFloat(getComputedStyle(group).rowGap) <= 12 && [...group.children].every((el) => {
        const style = getComputedStyle(el);
        return parseFloat(style.marginTop) === 0 && parseFloat(style.marginBottom) === 0;
      });
      results.push({ rule: "form-disclosures", ok, selector: ".sms-opt-in-disclosures", detail: ok ? "SMS disclosures form one compact group" : "SMS disclosures are missing their compact group or have paragraph margins" });
    });

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

    // Matchup summaries must not squeeze ordinary labels into vertical columns.
    document.querySelectorAll(".hub-week-forecast").forEach((forecast) => {
      if (!forecast.getClientRects().length) return;
      const labels = [...forecast.querySelectorAll(":scope > span")];
      const readable = labels.every((label) => {
        const style = getComputedStyle(label);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        return label.getBoundingClientRect().height <= line * 2 + 1;
      });
      results.push({rule: "week-forecast", ok: readable, selector: ".hub-week-forecast",
        detail: readable ? "matchup labels fit within two lines" : "compressed matchup labels exceed two lines"});
    });

    // Approved My team A keeps the short summary above the full roster, never in an empty sidebar.
    document.querySelectorAll(".my-team-page").forEach((page) => {
      const summary = page.querySelector(".my-team-overview");
      const roster = page.querySelector(".my-team-main");
      if (!summary || !roster || !summary.getClientRects().length || !roster.getClientRects().length) return;
      const a = summary.getBoundingClientRect(), b = roster.getBoundingClientRect();
      const ok = a.bottom <= b.top + 1 && Math.abs(a.left - b.left) <= 1 && Math.abs(a.width - b.width) <= 1;
      results.push({rule: "team-summary", ok, selector: ".my-team-page", detail: ok ? "Summary spans the roster above its controls" : "Summary must span the roster above its controls"});
    });

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
    const classNameOf = (el) => {
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
    document.querySelectorAll("*").forEach((el) => {
      if (el.matches("table, [role='table'], [role='grid']")) return;
      const tableLike = /table|grid/i.test(classNameOf(el)) || el.getAttribute("role") === "table";
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
      // Closed disclosures and hidden rule categories do not expose table columns.
      if (table.el.closest("[hidden]")) return;
      for (let ancestor = table.el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === "DETAILS" && !ancestor.open) return;
      }
      if (!table.el.getClientRects().length) return;
      // Phone card layouts have no shared column track to measure.
      if (table.el.tagName === "TABLE" && getComputedStyle(table.el).display !== "table") return;
      const rows = table.rows.filter((row) => rowCells(row).length && !row.closest("tfoot"));
      if (!rows.length) return;
      const colCount = Math.max(...rows.map((row) => rowCells(row).length));
      const expectAligns = [];
      for (let c = 0; c < colCount; c += 1) {
        const cells = rows.map((row) => rowCells(row)[c]).filter(Boolean);
        if (!cells.length) continue;
        const header = firstLine(cells[0]?.innerText || "");
        const bodyTexts = cells.slice(1).map((cell) => firstLine(cell.innerText));
        const glyph = bodyTexts.length && bodyTexts.every((t) => /^[A-Z]{1,3}$|^[QDP]$/.test(t));
        const action = /action/i.test(header) || (!table.el.matches(".rosters-table") && /actions|contract/i.test(cells[0]?.className || ""));
        const numeric = bodyTexts.filter((t) => t && isNumeric(t)).length;
        let expect = "left";
        if ((cells[0]?.classList.contains("rosters-num") || cells[0]?.classList.contains("num"))) expect = "right";
        else if (cells[0]?.classList.contains("rosters-chevron")) expect = "center";
        else if (glyph) expect = "center";
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
        if (!table.el.matches(".rosters-table") && !remainder && colWidth > maxContent * packRatio + 1) {
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

    // Decorative disclosure/navigation icons must never take the browser's
    // default SVG size when preview markup and cached CSS are out of sync.
    const controlIcons = [...document.querySelectorAll(".section-icon svg, .control-caret svg, .more-control svg")];
    controlIcons.forEach((el) => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      if (box.width > 32 || box.height > 32 || !el.hasAttribute("width") || !el.hasAttribute("height")) {
        results.push({ rule: "icons", ok: false, selector: elementClassName(el.parentElement), detail: `icon ${px(box.width)}×${px(box.height)}px; requires explicit dimensions and ≤32px` });
      }
    });
    if (controlIcons.length && !results.some((r) => r.rule === "icons" && !r.ok)) {
      results.push({ rule: "icons", ok: true, selector: "", detail: "control icons bounded with intrinsic dimensions" });
    }

    // All three product areas use the same compact phone header primitive.
    if (window.innerWidth <= 768) document.querySelectorAll(".app-header-shell").forEach((header) => {
      const box = header.getBoundingClientRect();
      const title = header.querySelector(".app-header-mobile-title");
      if (!box.width || !box.height || !title) return;
      const cs = getComputedStyle(header);
      const type = getComputedStyle(title);
      const rootStyle = getComputedStyle(document.documentElement);
      const expectedRadius = parseFloat(rootStyle.getPropertyValue("--radius-lg"));
      const expectedSize = tokenPixels("--text-xl");
      const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius].map(parseFloat);
      const sameCorners = radii.every(radius => Math.abs(radius - expectedRadius) <= 1);
      const boldTitle = Number(type.fontWeight) === Number(rootStyle.getPropertyValue("--font-weight-bold"));
      const balancedInsets = Math.abs(parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) <= 1 && Math.abs(parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) <= 1;
      const row = header.querySelector(".app-header-mobile-top");
      const divider = row && parseFloat(getComputedStyle(row).borderBottomWidth) > 0;
      results.push({ rule: "phone-chrome", ok: sameCorners && boldTitle && balancedInsets && box.height <= 72 && !divider && Math.abs(parseFloat(type.fontSize) - expectedSize) <= 1, selector: ".app-header-shell", detail: `${px(box.height)}px; corners ${radii.join("/")}; title ${type.fontSize}; ${divider ? "extra divider" : "shared hierarchy"}` });
    });

    document.querySelectorAll(".phone-header[data-compact-header]").forEach((header) => {
      const box = header.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const duplicateStrip = [...document.querySelectorAll(".mock-league-strip")].some(el => el.getBoundingClientRect().height > 0);
      results.push({ rule: "phone-chrome", ok: box.height <= 72 && !duplicateStrip, selector: ".phone-header", detail: `${px(box.height)}px; ${duplicateStrip ? "duplicate league row" : "single destination/league row"}` });
    });

    if (window.innerWidth > 768) {
      document.querySelectorAll(".mock-league-strip").forEach((strip) => {
        const control = strip.querySelector(".league-button");
        if (!control || !strip.getBoundingClientRect().height) return;
        const inset = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
        const gap = control.getBoundingClientRect().left - strip.getBoundingClientRect().left - inset;
        results.push({ rule: "desktop-league", ok: Math.abs(gap) <= 2, selector: ".mock-league-strip", detail: `league switcher ${px(gap)}px from left content edge` });
      });
    }

    // Both entry directions on the compact slate keep the same square control.
    document.querySelectorAll(".hub-wcc-board--compact .hub-wcc-row").forEach(row => {
      if (!row.getBoundingClientRect().height) return;
      const button = row.querySelector(".hub-wcc-position-button");
      const rect = button?.getBoundingClientRect();
      // Use the same CSS-pixel dimensions as the target check; viewport scaling can yield 43.993 for a 44px control.
      results.push({ rule:"lineup-controls", ok:Boolean(rect && button.offsetWidth >= minTarget && button.offsetHeight >= minTarget && Math.abs(rect.width-rect.height) <= 1), selector:".hub-wcc-position-button", detail:rect ? `${px(rect.width)}×${px(rect.height)}px` : "missing starter/bench control" });
      const call = row.querySelector(".hub-wcc-call-pill.is-start");
      if (call) {
        const bounds = call.getBoundingClientRect();
        const fits = [...call.children].every(child => { const r = child.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom; });
        results.push({rule:"lineup-controls",ok:fits,selector:".hub-wcc-call-pill.is-start",detail:fits ? "label and delta fit" : "call text exceeds button"});
      }
    });
    document.querySelectorAll(".app-header-mobile-top[data-compact-header]").forEach(header => {
      const rect=header.getBoundingClientRect();
      if (!rect.height || !rect.width) return;
      const duplicate=[...document.querySelectorAll(".hub-league-context-bar:not(.is-header-slot)")].some(el=>el.getBoundingClientRect().height > 0);
      results.push({rule:"phone-chrome",ok:rect.height <= 72 && !duplicate,selector:".app-header-mobile-top",detail:`${px(rect.height)}px; ${duplicate ? "duplicate league strip" : "single header"}`});
    });

    const primaries = [...document.querySelectorAll(".btn-primary, button.btn-primary")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    results.push(
      primaries.length > 1
        ? { rule: "primaries", ok: false, selector: ".btn-primary", detail: `${primaries.length} visible primaries` }
        : { rule: "primaries", ok: true, selector: "", detail: `${primaries.length} visible primary` },
    );

    const xsPx = tokenPixels("--text-xs") || 0;
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
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1
        ? { rule: "overflow", ok: false, selector: "document", detail: `scrollWidth=${Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)} innerWidth=${window.innerWidth}` }
        : { rule: "overflow", ok: true, selector: "", detail: "no horizontal overflow" },
    );

    const hub = document.querySelector(".draft-hub");
    if (hub) {
      const kids = [...hub.children].filter((el) => {
        const cls = classNameOf(el);
        return !/\b(hub-atmosphere|fantasy-chat-dock)\b/.test(cls);
      });
      const hosts = kids.filter((el) => (
        el.classList.contains("hub-league-context-bar")
        || el.querySelector(".hub-filter-menu, .hub-league-context-sync")
      ));
      let menuFails = 0;
      hosts.forEach((host) => {
        const hostZ = getComputedStyle(host).zIndex;
        const hostIdx = kids.indexOf(host);
        kids.slice(hostIdx + 1).forEach((sib) => {
          const sibZ = getComputedStyle(sib).zIndex;
          const hostN = Number.parseInt(hostZ, 10);
          const sibN = Number.parseInt(sibZ, 10);
          const covered = !Number.isFinite(hostN) || (Number.isFinite(sibN) && sibN >= hostN);
          if (!covered) return;
          menuFails += 1;
          if (menuFails <= 4) {
            const hostName = classNameOf(host) || host.tagName;
            const sibName = classNameOf(sib) || sib.tagName;
            results.push({
              rule: "menus",
              ok: false,
              selector: hostName,
              detail: `z-index ${hostZ} covered by later sibling ${sibName} z-index ${sibZ}`,
            });
          }
        });
      });
      if (!results.some((r) => r.rule === "menus" && !r.ok)) {
        results.push({
          rule: "menus",
          ok: true,
          selector: "",
          detail: hosts.length ? "strip menus stack above later hub siblings" : "no strip menu host",
        });
      }
    } else {
      results.push({ rule: "menus", ok: true, selector: "", detail: "no draft-hub" });
    }

    // A phone must leave room for complete manager names and avoid a separate
    // navigation row between the Record book heading and its rankings.
    if (innerWidth <= 768) {
      const years = [...document.querySelectorAll(".hub-insights-year")];
      const narrow = years.filter(year => {
        const owner = year.querySelector("strong");
        return owner && owner.getBoundingClientRect().width < Math.min(160, innerWidth * .45);
      });
      if (years.length) results.push({rule:"insights-mobile",ok:!narrow.length,
        selector:".hub-insights-year",detail: narrow.length ? "Championship manager column is too narrow" : "Championship names have room to read"});
      const controls = [...document.querySelectorAll(".hub-insights-record-sort button, .hub-insights-record-book .hub-insights-open-scoring, .hub-insights-record-book .hub-insights-talk-head button")];
      if (controls.length) {
        const boxes = controls.map(el => el.getBoundingClientRect());
        const aligned = boxes.every(box => Math.abs(box.top - boxes[0].top) < 2 && Math.abs(box.height - boxes[0].height) < 2);
        results.push({rule:"insights-mobile",ok:aligned,selector:".hub-insights-record-controls",
          detail:aligned ? "Record book controls share one row" : "Record book controls create extra rows"});
      }
    }

    const destinationButton = document.querySelector(".hub-subnav-picker-btn");
    if (destinationButton && destinationButton.getBoundingClientRect().width > 0) {
      results.push({rule:"navigation", ok:destinationButton.scrollWidth <= destinationButton.clientWidth + 1,
        selector:".hub-subnav-picker-btn", detail:"destination label fits its button"});
    }
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
  const openMenuResults = await auditOpenMenus(page);
  results.push(...openMenuResults);
  results.push(...await auditLockerStability(page));
  await page.close();
  return results;
}

async function auditOpenMenus(page) {
  const specs = [
    {
      name: "Switch league",
      trigger: ".hub-league-context-identity .hub-filter-menu-trigger",
      panel: ".hub-filter-menu-panel",
    },
    {
      name: "Sync league",
      trigger: ".hub-league-context-sync-trigger",
      panel: ".hub-league-context-sync-panel",
    },
  ];
  const results = [];
  for (const spec of specs) {
    const trigger = page.locator(spec.trigger).first();
    if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) {
      continue;
    }
    // Dispatch click in-page. Playwright's actionability hover would open
    // HubFilterMenu, then the click would toggle it closed.
    await trigger.evaluate((el) => el.click());
    await page.locator(spec.panel).first().waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
    const probe = await page.evaluate(({ panelSel, name }) => {
      const classNameOf = (node) => {
        if (!node) return "";
        if (typeof node.getAttribute === "function") {
          const named = node.getAttribute("class");
          if (named != null) return String(named);
        }
        const raw = node.className;
        if (typeof raw === "string") return raw;
        if (raw && typeof raw.baseVal === "string") return raw.baseVal;
        return "";
      };
      const panel = document.querySelector(panelSel);
      if (!panel) {
        return { rule: "menus", ok: false, selector: name, detail: "panel did not open" };
      }
      const r = panel.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) {
        return { rule: "menus", ok: false, selector: name, detail: "panel has no box" };
      }
      const samples = [
        [r.left + r.width / 2, r.top + Math.min(16, r.height / 3)],
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + Math.min(20, r.width / 4), r.top + Math.min(16, r.height / 3)],
      ];
      for (const [x, y] of samples) {
        const el = document.elementFromPoint(x, y);
        if (!el || !panel.contains(el)) {
          const cover = el ? (classNameOf(el) || el.tagName) : "null";
          return {
            rule: "menus",
            ok: false,
            selector: name,
            detail: `covered by ${cover} at ${Math.round(x)},${Math.round(y)}`,
          };
        }
      }
      return { rule: "menus", ok: true, selector: name, detail: "panel paints above page" };
    }, { panelSel: spec.panel, name: spec.name });
    results.push(probe);
    await trigger.evaluate((el) => el.click()).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  }
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
