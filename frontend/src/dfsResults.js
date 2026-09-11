import { parseDfsCsv, headerKey, moneyCents } from "./dfsCsv.js";

export const RESULT_FIELDS = [
  ["entry_id", "Entry ID", ["entryid"]],
  ["contest_id", "Contest ID", ["contestid"]],
  ["contest_name", "Contest name", ["contestname", "contest"]],
  ["date", "Date", ["date", "contestdate", "startdate"]],
  ["fee_cents", "Entry fee", ["entryfee", "fee"]],
  ["payout_cents", "Payout", ["payout", "winnings", "prize", "amountwon"]],
  ["points", "Actual points", ["points", "fantasypoints", "fpts"]],
  ["rank", "Rank", ["rank", "place"]],
  ["lineup_text", "Lineup", ["lineup"]],
];

export function inspectResultsCsv(text) {
  const rows = parseDfsCsv(text);
  if (rows.length < 2) throw new Error("The CSV has no entry rows.");
  const keys = rows[0].map(headerKey);
  const mapping = Object.fromEntries(
    RESULT_FIELDS.map(([field, , aliases]) => [
      field,
      keys.findIndex((k) => aliases.includes(k)),
    ]),
  );
  return { headers: rows[0], rows: rows.slice(1), mapping };
}

export function parseResultsRows(
  file,
  mapping,
  {
    site = "draftkings",
    kind = "history",
    contestId = "",
    settled = true,
  } = {},
) {
  const seen = new Set();
  const get = (r, k) =>
    Number(mapping[k]) >= 0 ? String(r[Number(mapping[k])] ?? "").trim() : "";
  return file.rows.map((row, i) => {
    const entry = {
      site,
      entry_id: get(row, "entry_id"),
      contest_id: get(row, "contest_id") || contestId.trim(),
    };
    if (!entry.entry_id || !entry.contest_id)
      throw new Error(
        `Row ${i + 2} needs an entry ID and contest ID. Map those columns or supply the contest ID.`,
      );
    const key = `${entry.contest_id}|${entry.entry_id}`;
    if (seen.has(key))
      throw new Error(`Entry ${entry.entry_id} appears twice in this contest.`);
    seen.add(key);
    for (const k of ["contest_name", "lineup_text"])
      if (get(row, k)) entry[k] = get(row, k);
    const date = get(row, "date");
    if (date) {
      const iso = date.match(/^(\d{4}-\d{2}-\d{2})(?:\b|T)/)?.[1];
      const us = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\b|\s)/);
      entry.date =
        iso ||
        (us
          ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
          : "");
      if (
        !entry.date ||
        Number.isNaN(Date.parse(entry.date)) ||
        new Date(entry.date).toISOString().slice(0, 10) !== entry.date
      )
        throw new Error(
          `Row ${i + 2} needs a valid YYYY-MM-DD or MM/DD/YYYY date.`,
        );
    }
    if (kind === "history") {
      entry.fee_cents = moneyCents(get(row, "fee_cents"));
      const payout = get(row, "payout_cents");
      if (settled) entry.payout_cents = moneyCents(payout);
      else if (payout) entry.payout_cents = moneyCents(payout);
      entry.status = settled ? "settled" : "unsettled";
    }
    for (const k of ["points", "rank"]) {
      const raw = get(row, k).replaceAll(",", "");
      if (raw) {
        const value = Number(raw);
        if (
          !Number.isFinite(value) ||
          (k === "rank" && (!Number.isInteger(value) || value < 1))
        )
          throw new Error(`Invalid ${k} on row ${i + 2}.`);
        entry[k] = value;
      }
    }
    if (
      kind === "results" &&
      entry.points == null &&
      entry.rank == null &&
      !entry.lineup_text
    )
      throw new Error(`No score, rank or lineup found on row ${i + 2}.`);
    return entry;
  });
}

export function resultTotals(entries = []) {
  const settled = entries.filter((e) => e.status === "settled");
  const complete = settled.filter(
    (e) =>
      Number.isSafeInteger(e.fee_cents) && Number.isSafeInteger(e.payout_cents),
  );
  const fees = complete.reduce((s, e) => s + e.fee_cents, 0);
  const payouts = complete.reduce((s, e) => s + e.payout_cents, 0);
  const missing = settled.length - complete.length;
  const net = payouts - fees;
  const byDate = new Map();
  complete
    .filter((e) => e.date)
    .forEach((e) => {
      const sum = byDate.get(e.date) || { date: e.date, fees: 0, payouts: 0 };
      sum.fees += e.fee_cents;
      sum.payouts += e.payout_cents;
      byDate.set(e.date, sum);
    });
  let cumulativeFees = 0,
    cumulativePayouts = 0;
  const chart = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      ...r,
      fees: (cumulativeFees += r.fees) / 100,
      payouts: (cumulativePayouts += r.payouts) / 100,
    }));
  return {
    fees,
    payouts,
    net,
    roi: fees > 0 && !missing ? (net / fees) * 100 : null,
    complete: complete.length,
    missing,
    unsettled: entries.filter((e) => e.status !== "settled").length,
    chart,
    undated: complete.filter((e) => !e.date).length,
  };
}

export function linkedLineup(entry, builds) {
  return (
    builds.find((b) => b.id === entry.build_id)?.lineups?.[
      entry.lineup_index ?? 0
    ]?.lineup || []
  );
}

export function resultGroups(entries, builds, group = "captain") {
  const groups = new Map();
  entries
    .filter(
      (e) =>
        e.status === "settled" &&
        Number.isSafeInteger(e.fee_cents) &&
        Number.isSafeInteger(e.payout_cents),
    )
    .forEach((e) => {
      const lineup = linkedLineup(e, builds);
      const captain = lineup.find((p) => ["CPT", "MVP"].includes(p.slot));
      const parsedCaptain = e.lineup_text?.match(
        /(?:^|\s)CPT\s+(.+?)(?=\s+FLEX\s|$)/,
      )?.[1];
      let key =
        group === "contest"
          ? e.contest_name || e.contest_id
          : captain?.player || parsedCaptain || "Captain unavailable";
      if (group === "salary") {
        const build = builds.find((b) => b.id === e.build_id);
        const left =
          build && lineup.length
            ? Number(build.settings.salary_cap) -
              lineup.reduce((s, p) => s + Number(p.salary || 0), 0)
            : null;
        key =
          left == null
            ? "Salary unavailable"
            : left < 500
              ? "$0–499 unused"
              : left < 1500
                ? "$500–1,499 unused"
                : "$1,500+ unused";
      }
      if (group === "stack") {
        const qbs = lineup.filter((p) => p.position === "QB");
        key = lineup.length
          ? qbs
              .map(
                (q) =>
                  `${q.player} + ${lineup.filter((p) => p.team === q.team && ["WR", "TE"].includes(p.position)).length}`,
              )
              .join(" / ") || "No QB"
          : "Stack unavailable";
      }
      const row = groups.get(key) || {
        label: key,
        count: 0,
        fees: 0,
        payouts: 0,
      };
      row.count++;
      row.fees += e.fee_cents;
      row.payouts += e.payout_cents;
      groups.set(key, row);
    });
  return [...groups.values()]
    .map((r) => ({
      ...r,
      net: r.payouts - r.fees,
      roi: r.fees ? ((r.payouts - r.fees) / r.fees) * 100 : null,
    }))
    .sort((a, b) => b.net - a.net);
}

export const dollars = (cents) =>
  Number.isFinite(cents)
    ? (cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      })
    : "—";
