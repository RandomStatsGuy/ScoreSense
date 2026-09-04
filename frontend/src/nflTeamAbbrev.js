/** Display abbreviations that match Weekly (LAR, not LA). */

const TO_DISPLAY = Object.freeze({
  LA: "LAR",
  JAC: "JAX",
  WAS: "WSH",
});

export function displayNflTeam(team) {
  const raw = String(team || "").trim().toUpperCase();
  if (!raw || raw === "NAN" || raw === "NONE" || raw === "NULL") return "—";
  return TO_DISPLAY[raw] || raw;
}
