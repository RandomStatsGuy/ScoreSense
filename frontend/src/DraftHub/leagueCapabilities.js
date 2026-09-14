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

/**
 * Same derivation as src/draft_hub/league_capabilities.py, for the components
 * that are handed league rules rather than the hub context. Keeping one client
 * definition stops a second draft-type predicate growing beside this one.
 */
export function capabilitiesFromRules(rules) {
  const usesSalaries = String(rules?.draft_type || "auction") === "auction";
  return {
    economics: usesSalaries ? "salary_cap" : "none",
    uses_salaries: usesSalaries,
    uses_contracts: usesSalaries,
    acquisition_mode: usesSalaries ? "bid" : "priority",
  };
}

export function rulesUseContracts(rules) {
  return capabilitiesFromRules(rules).uses_contracts;
}
