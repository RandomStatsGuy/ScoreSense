import { useCallback, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { isAbortError } from "../fetchAbort";

/**
 * Projection/draft meta and season-week context shared across App projections views.
 */
export default function useProjectionsMeta() {
  const [projMeta, setProjMeta] = useState(null);
  const [draftMeta, setDraftMeta] = useState(null);
  const [season, setSeason] = useState(null);
  const [week, setWeek] = useState(null);
  const [rosSeason, setRosSeason] = useState(null);
  const [rosFromWeek, setRosFromWeek] = useState(null);
  const [draftSeason, setDraftSeason] = useState(null);
  const projMetaRef = useRef(null);
  projMetaRef.current = projMeta;

  const weekOptions = useMemo(() => {
    if (!projMeta || season == null) return [];
    return projMeta.weeks_by_season?.[String(season)] || [];
  }, [projMeta, season]);

  const rosWeekOptions = useMemo(() => {
    if (!projMeta || rosSeason == null) return [];
    return projMeta.weeks_by_season?.[String(rosSeason)] || [];
  }, [projMeta, rosSeason]);

  const isLiveContext = useMemo(() => {
    if (season == null || week == null || !projMeta) return false;
    return season === projMeta.default_season && week === projMeta.default_week;
  }, [season, week, projMeta]);

  const fetchProjMeta = useCallback(async (pos, signal) => {
    try {
      const res = await apiFetch(`/api/meta/projections/${pos}`, { signal });
      if (!res.ok) return null;
      const data = await res.json();
      if (signal?.aborted) return null;
      setProjMeta(data);
      setSeason(data.default_season);
      setWeek(data.default_week);
      setRosSeason(data.default_season);
      setRosFromWeek(data.default_week);
      return data;
    } catch (err) {
      if (!isAbortError(err)) {
        /* optional during dev */
      }
      return null;
    }
  }, []);

  const fetchDraftMeta = useCallback(async (pos, signal) => {
    try {
      const res = await apiFetch(`/api/meta/draft/${pos}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (signal?.aborted) return;
      setDraftMeta(data);
      setDraftSeason(data.default_season);
    } catch (err) {
      if (!isAbortError(err)) {
        /* optional during dev */
      }
    }
  }, []);

  return {
    projMeta,
    setProjMeta,
    draftMeta,
    season,
    setSeason,
    week,
    setWeek,
    rosSeason,
    setRosSeason,
    rosFromWeek,
    setRosFromWeek,
    draftSeason,
    setDraftSeason,
    projMetaRef,
    weekOptions,
    rosWeekOptions,
    isLiveContext,
    fetchProjMeta,
    fetchDraftMeta,
  };
}
