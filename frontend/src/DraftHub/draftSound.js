const DRAFT_SOUND_STORAGE_KEY = "scoresense-draft-sound";

export function draftEventSoundKey(event) {
  if (!event) return "";
  const payload = event.payload || {};
  return String(
    event.id
      ?? payload.id
      ?? `${event.event_type || event.type || "event"}:${event.created_at || payload.created_at || ""}:${payload.overall || payload.amount || ""}`,
  );
}

export function draftToneForEvent(event) {
  const type = String(event?.event_type || event?.type || "").toLowerCase();
  if (type === "pick") return "pick";
  if (type === "win") return "win";
  if (type === "bid") return "bid";
  return null;
}

export function loadDraftSoundPreference(storage = globalThis?.localStorage) {
  try {
    return storage?.getItem(DRAFT_SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveDraftSoundPreference(enabled, storage = globalThis?.localStorage) {
  try {
    storage?.setItem(DRAFT_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* preference storage is optional */
  }
}

export function playDraftTone(kind, AudioContextClass = globalThis?.AudioContext || globalThis?.webkitAudioContext) {
  if (!AudioContextClass) return false;
  try {
    const context = new AudioContextClass();
    const now = context.currentTime;
    const notes = kind === "win"
      ? [523.25, 659.25, 783.99]
      : kind === "pick"
        ? [440, 659.25]
        : kind === "preview"
          ? [523.25]
          : [330];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.075;
      oscillator.type = kind === "bid" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === "bid" ? 0.035 : 0.06, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    });
    const closeAfter = now + notes.length * 0.075 + 0.2;
    globalThis.setTimeout?.(() => context.close?.(), Math.ceil((closeAfter - now) * 1000));
    return true;
  } catch {
    return false;
  }
}

export { DRAFT_SOUND_STORAGE_KEY };
