/** Independent diagnostic request; preserve lineup constraints, not portfolio rules. */
export function captainComparisonRequest(request) {
  return {
    ...request,
    include_captain_comparison: true,
    lineup_count: 1,
    randomness: 0,
    max_exposure: null,
    captain_exposure_limits: {},
    max_overlap: 6,
    require_qb_stack: false,
    qb_stack_count: 0,
    stack_bring_back: false,
    stack_teams: null,
    stack_qb_ids: null,
    stack_game_weights: [],
  };
}
