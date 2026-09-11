import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./auth";
import {
  DEFAULT_FORMATS,
  defaultSlateCategory,
  isCaptainFormat,
} from "./dfsToolPresentation";
import { parseDfsCsv, headerKey } from "./dfsCsv";

async function jsonRequest(url, options) {
  const response = await apiFetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  return data;
}
export { jsonRequest };

export default function useDfsBuilder(projMeta) {
  const [meta, setMeta] = useState(projMeta);
  const [formats, setFormats] = useState(DEFAULT_FORMATS);
  const [context, setContext] = useState({
    site: "draftkings_showdown",
    season: null,
    week: null,
    slateId: "",
    source: "live",
  });
  const [slates, setSlates] = useState([]);
  const [pool, setPool] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [stats, setStats] = useState(null);
  const [slateName, setSlateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lineups, setLineups] = useState([]);
  const [selected, setSelected] = useState(0);
  const [savedBuild, setSavedBuild] = useState(null);
  const [buildSettings, setBuildSettings] = useState(null);
  const [locked, setLocked] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [ownership, setOwnership] = useState({});
  const [captainLimits, setCaptainLimits] = useState({});
  const [settings, setSettings] = useState({
    count: 20,
    objective: "median",
    exposure: 1,
    differences: 2,
    qbStack: 0,
    bringBack: false,
    maxTeam: 0,
    minSalary: 0,
    maxSalary: 50000,
    randomness: 0,
    lockedCaptain: "",
    note: "",
  });
  const generation = useRef(0);
  const revision = useRef(0);
  const config = formats[context.site] || DEFAULT_FORMATS[context.site];
  const isDfs = context.site !== "seasonal";
  const isCaptain = isCaptainFormat(context.site, formats);
  const changeSetting = (key, value) =>
    setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    const abort = new AbortController();
    if (!projMeta)
      jsonRequest("/api/meta/projections/qb", { signal: abort.signal })
        .then(setMeta)
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    jsonRequest("/api/lineup/formats", { signal: abort.signal })
      .then((d) => setFormats(d.formats || DEFAULT_FORMATS))
      .catch(() => {});
    return () => abort.abort();
  }, [projMeta]);
  useEffect(() => {
    if (projMeta) setMeta(projMeta);
  }, [projMeta]);
  useEffect(() => {
    if (meta)
      setContext((c) => ({
        ...c,
        season: c.season ?? meta.default_season,
        week: c.week ?? meta.default_week,
      }));
  }, [meta]);

  const changeContext = (patch) => {
    generation.current++;
    revision.current++;
    setContext((c) => ({
      ...c,
      ...patch,
      slateId: patch.site ? "" : (patch.slateId ?? c.slateId),
      source: "live",
    }));
    setPool([]);
    setSalaries([]);
    setStats(null);
    setLineups([]);
    setSavedBuild(null);
    changeSetting("lockedCaptain", "");
    setLocked([]);
    setExcluded([]);
    setCaptainLimits({});
    setOverrides({});
    setOwnership({});
    setError("");
    setNotice("");
    if (patch.site)
      changeSetting(
        "maxSalary",
        (formats[patch.site] || DEFAULT_FORMATS[patch.site]).salary_cap || 0,
      );
  };

  useEffect(() => {
    if (!isDfs || context.source !== "live") return;
    const abort = new AbortController();
    setBusy(true);
    jsonRequest(
      `/api/lineup/slates?site=${context.site}&category=${defaultSlateCategory(context.site, formats)}`,
      { signal: abort.signal },
    )
      .then((d) => {
        if (abort.signal.aborted) return;
        const list = d.slates || [];
        setSlates(list);
        setContext((c) => ({
          ...c,
          slateId: list.some((s) => String(s.slate_id) === c.slateId)
            ? c.slateId
            : String(list[0]?.slate_id || ""),
        }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [context.site, context.source, isDfs]);

  const acceptPool = (data, name) => {
    setPool(data.players || []);
    setSalaries(data.salaries || []);
    setStats(data.stats || null);
    setSlateName(data.slate?.name || name || "");
    setLineups([]);
    setSavedBuild(null);
    setNotice("");
  };
  useEffect(() => {
    if (
      context.season == null ||
      context.week == null ||
      context.source !== "live" ||
      (isDfs && !context.slateId)
    )
      return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      site: context.site,
      season: context.season,
      week: context.week,
      slate_id: context.slateId,
      apply_injury_adjustments: String(
        context.season === meta?.default_season &&
          context.week === meta?.default_week,
      ),
    });
    jsonRequest(`/api/lineup/${isDfs ? "salaries/load" : "pool"}?${params}`, {
      signal: abort.signal,
    })
      .then((d) => {
        if (!abort.signal.aborted) acceptPool(d);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [
    context.site,
    context.season,
    context.week,
    context.slateId,
    context.source,
    isDfs,
  ]);

  const importSalary = async (file) => {
    if (!file) return;
    const seq = ++generation.current;
    revision.current++;
    setPool([]);
    setSalaries([]);
    setStats(null);
    setLineups([]);
    setSavedBuild(null);
    changeSetting("lockedCaptain", "");
    setContext((c) => ({ ...c, source: "upload", slateId: "" }));
    setBusy(true);
    setError("");
    setLocked([]);
    setExcluded([]);
    setOverrides({});
    setOwnership({});
    setCaptainLimits({});
    try {
      const form = new FormData();
      form.append("file", file);
      const d = await jsonRequest(
        `/api/lineup/salaries/import?site=${context.site}&season=${context.season}&week=${context.week}`,
        { method: "POST", body: form },
      );
      if (seq === generation.current) acceptPool(d, file.name);
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      if (seq === generation.current) setBusy(false);
    }
  };
  const importProjections = async (file) => {
    if (!file) return;
    try {
      const rows = parseDfsCsv(await file.text()),
        keys = rows[0].map(headerKey);
      const columns = {
        id: keys.indexOf("id"),
        proj: keys.indexOf("proj"),
        floor: keys.indexOf("floor"),
        ceiling: keys.indexOf("ceiling"),
        own: keys.indexOf("ownership"),
      };
      if (Object.entries(columns).some(([k, v]) => k !== "own" && v < 0))
        throw new Error(
          "Use columns ID, Proj, Floor, Ceiling and optional Ownership. ID is the slate's FLEX player ID.",
        );
      const next = {},
        own = {};
      for (const row of rows.slice(1)) {
        const p = pool.find(
          (p) => String(p.dfs_id) === row[columns.id]?.trim(),
        );
        if (!p)
          throw new Error(`Player ID ${row[columns.id]} is not in this slate.`);
        const v = Object.fromEntries(
          ["proj", "floor", "ceiling"].map((k) => [
            k,
            row[columns[k]]?.trim() === "" ? NaN : Number(row[columns[k]]),
          ]),
        );
        if (
          Object.values(v).some(
            (n) => !Number.isFinite(n) || n < -20 || n > 150,
          ) ||
          v.floor > v.proj ||
          v.proj > v.ceiling
        )
          throw new Error(
            "Each row needs Floor â‰¤ Proj â‰¤ Ceiling, between -20 and 150 points.",
          );
        if (next[p.player_id])
          throw new Error("The projection file repeats a player ID.");
        next[p.player_id] = v;
        if (columns.own >= 0 && row[columns.own]?.trim()) {
          const n = Number(row[columns.own].replace("%", ""));
          if (!Number.isFinite(n) || n < 0 || n > 100)
            throw new Error("Ownership must be a percentage from 0 to 100.");
          own[p.player_id] = n;
        }
      }
      setOverrides(next);
      setOwnership(own);
      setNotice(
        `Imported projections for ${Object.keys(next).length} players. Rebuild to apply them.`,
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const toggle = (id, kind) => {
    const setter = kind === "lock" ? setLocked : setExcluded,
      other = kind === "lock" ? setExcluded : setLocked;
    setter((list) =>
      list.includes(id) ? list.filter((p) => p !== id) : [...list, id],
    );
    other((list) => list.filter((p) => p !== id));
  };
  const run = async () => {
    const seq = generation.current;
    revision.current++;
    setBuilding(true);
    setError("");
    setNotice("");
    const cap = isDfs
      ? Math.min(Number(settings.maxSalary), Number(config.salary_cap))
      : null;
    const request = {
      site: context.site,
      season: context.season,
      week: context.week,
      slate_salaries: salaries,
      objective: settings.objective,
      salary_cap: cap,
      locked_player_ids: locked,
      excluded_player_ids: excluded,
      lineup_count: settings.count,
      max_overlap: Math.max(
        0,
        (isCaptain ? 6 : isDfs ? 9 : 7) - settings.differences,
      ),
      max_exposure: settings.exposure,
      randomness: settings.randomness,
      min_salary: settings.minSalary || null,
      max_per_team: settings.maxTeam || null,
      qb_stack_count: isCaptain ? 0 : settings.qbStack,
      stack_bring_back: !isCaptain && settings.bringBack,
      locked_captain_id: isCaptain ? settings.lockedCaptain || null : null,
      captain_exposure_limits: isCaptain ? captainLimits : {},
      projection_overrides: overrides,
      apply_injury_adjustments:
        context.season === meta?.default_season &&
        context.week === meta?.default_week,
      block_bye_weeks: true,
    };
    try {
      if (
        isDfs &&
        (!salaries.length ||
          !Number.isFinite(cap) ||
          cap <= 0 ||
          settings.minSalary > cap)
      )
        throw new Error(
          "Load salaries and check the salary range before building.",
        );
      const data = await jsonRequest("/api/lineup/optimize", {
        method: "POST",
        body: JSON.stringify(request),
      });
      if (seq !== generation.current) return;
      if (!data.ok)
        throw new Error(data.error || "No lineup satisfies these settings.");
      const built = data.lineups || [
        {
          lineup: data.lineup,
          total_salary: data.total_salary,
          total_points: data.total_points,
        },
      ];
      setLineups(built);
      setSelected(0);
      setSavedBuild(null);
      setBuildSettings({
        ...request,
        note: settings.note,
        ownership,
        projection_sources: Object.fromEntries(
          pool.map((p) => [
            p.player_id,
            overrides[p.player_id] ? "Imported" : p.projection_source,
          ]),
        ),
        snapshot_at: new Date().toISOString(),
      });
      setNotice(
        built.length < settings.count
          ? `Built ${built.length} of ${settings.count}. Limits count toward the requested set; review actual exposure before exporting. ${data.note || ""}`
          : `Built ${built.length} lineup${built.length === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      setBuilding(false);
    }
  };
  const save = async () => {
    const version = revision.current;
    try {
      const saved = await jsonRequest("/api/lineup/builds", {
        method: "POST",
        body: JSON.stringify({
          site: context.site,
          slate_id: context.slateId,
          slate_name: slateName,
          lineups,
          settings: buildSettings || {},
          note: buildSettings?.note || "",
        }),
      });
      if (version !== revision.current) return null;
      setSavedBuild(saved);
      setNotice("Build saved with its original projections and settings.");
      return saved;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  const visiblePool = pool.map((p) =>
    overrides[p.player_id]
      ? {
          ...p,
          "Projected Points": overrides[p.player_id].proj,
          "Low (P10)": overrides[p.player_id].floor,
          "High (P90)": overrides[p.player_id].ceiling,
          projection_source: "Imported",
        }
      : p,
  );
  return {
    meta,
    formats,
    context,
    changeContext,
    slates,
    pool: visiblePool,
    salaries,
    stats,
    slateName,
    busy,
    building,
    error,
    setError,
    notice,
    lineups,
    selected,
    setSelected,
    savedBuild,
    save,
    locked,
    excluded,
    toggle,
    overrides,
    ownership,
    captainLimits,
    setCaptainLimits,
    settings,
    changeSetting,
    config,
    isDfs,
    isCaptain,
    importSalary,
    importProjections,
    run,
  };
}
