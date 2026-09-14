/** Client view of authoritative Fantasy league capabilities from hub context. */

export function leagueCapabilitiesFromContext(hubContext) {
  const raw = hubContext?.capabilities;
  if (!raw || typeof raw !== "object") {
    return {
      version: 0,
      economics: "salary_cap",
      uses_salaries: true,
      uses_contracts: true,
      acquisition_mode: "bid",
    };
  }
  return {
    version: Number(raw.version) || 0,
    economics: raw.economics || (raw.uses_salaries ? "salary_cap" : "none"),
    uses_salaries: Boolean(raw.uses_salaries),
    uses_contracts: Boolean(raw.uses_contracts),
    acquisition_mode: raw.acquisition_mode || (raw.uses_salaries ? "bid" : "priority"),
  };
}

export function leagueUsesSalaries(hubContext) {
  return leagueCapabilitiesFromContext(hubContext).uses_salaries;
}

export function leagueUsesContracts(hubContext) {
  return leagueCapabilitiesFromContext(hubContext).uses_contracts;
}

export function leagueUsesPriorityClaims(hubContext) {
  return leagueCapabilitiesFromContext(hubContext).acquisition_mode === "priority";
}
