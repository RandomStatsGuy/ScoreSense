"""Pydantic models for Draft Hub API."""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


class PositionRule(BaseModel):
    min: int = 0
    max: int = 99
    starter: int = 0


class FlexRule(BaseModel):
    starter: int = 0
    eligible: list[str] = Field(default_factory=lambda: ["RB", "WR", "TE"])


class AuctionRules(BaseModel):
    min_bid: int = 1
    nomination_timer_sec: int = 60
    bid_timer_sec: int = 30
    bid_extension_sec: int = 5
    bot_reaction_delay_sec: int = 4
    allow_mid_draft_cuts: bool = True


class ContractRules(BaseModel):
    max_years: int = 3
    cut_refund_pct: float = 0.5
    extension_step_up: float = 5.0
    rookie_years: int = 2
    allow_veteran_renewal: bool = False
    one_renewal_after_rookie: bool = True


class LeagueRules(BaseModel):
    salary_cap: float = 200.0
    auction: AuctionRules = Field(default_factory=AuctionRules)
    roster: dict[str, Any] = Field(default_factory=dict)
    # Explicit total roster cap. When omitted, sum of per-position maxes is used.
    roster_size_max: Optional[int] = None
    contracts: ContractRules = Field(default_factory=ContractRules)
    # SCORE-3: Conservative (-1) / Balanced (0, default) / Aggressive (+1).
    # Neutral default keeps fair_value pricing unchanged until a league opts in.
    risk_tolerance: float = Field(default=0.0, ge=-1.0, le=1.0)


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    season: Optional[int] = None
    rules: Optional[LeagueRules] = None
    preset_id: Optional[str] = None


class RosterAddRequest(BaseModel):
    player_id: str
    player_name: str
    team: str = ""
    position: str
    salary: float
    contract_years: int = 1
    # Commissioners only: reassign a player already on another team's roster.
    force: bool = False


class RosterRemoveRequest(BaseModel):
    player_id: str


class RosterUpdateRequest(BaseModel):
    player_id: str
    salary: Optional[float] = None
    contract_years: Optional[int] = None  # years remaining on contract
    step_up: Optional[float] = None
    salary_schedule: Optional[list[float]] = None
    roster_status: Optional[str] = None  # active | cut_before_draft | expired
    contract_type: Optional[str] = None  # rookie | veteran | extension
    # SCORE-43: required for commissioner Office Current overrides (salary/years/status).
    note: Optional[str] = None


class HistoricCorrectionRequest(BaseModel):
    """SCORE-43 Correct historical record command."""

    reason: str = Field(..., min_length=3)
    mode: Literal["history_only", "preview_forward", "apply_forward"] = "history_only"
    updates: dict[str, Any] = Field(default_factory=dict)
    forward_rebuild_approved: bool = False
    # Convenience aliases accepted in updates or top-level:
    cap_hit: Optional[float] = None
    base_salary: Optional[float] = None
    prior_salary: Optional[float] = None
    roster_status: Optional[str] = None
    contract_phase: Optional[str] = None
    status_note: Optional[str] = None
    owner_label: Optional[str] = None
    hub_team_name: Optional[str] = None
    player_name: Optional[str] = None
    player_id: Optional[str] = None
    position: Optional[str] = None
    original_draft_year: Optional[int] = None
    acquisition_type: Optional[str] = None
    confidence: Optional[str] = None
    needs_review: Optional[bool] = None
    review_reason: Optional[str] = None


class ContractTypeUpdateRequest(BaseModel):
    player_id: str
    contract_type: str  # rookie | veteran | extension
    note: Optional[str] = None


class ContractTypeDecisionRequest(BaseModel):
    player_id: str
    approve: bool = True


class LeagueSettingsUpdate(BaseModel):
    lock_team_claims: Optional[bool] = None
    draft_completed: Optional[bool] = None


class AuctionRulesUpdate(BaseModel):
    min_bid: Optional[int] = None
    nomination_timer_sec: Optional[int] = None
    bid_timer_sec: Optional[int] = None
    bid_extension_sec: Optional[int] = None
    bot_reaction_delay_sec: Optional[int] = None


class NominationOrderUpdate(BaseModel):
    team_ids: list[str]


class ActiveLeagueUpdate(BaseModel):
  league_id: Optional[str] = None
  solo: bool = False


class LeagueCreateRequest(BaseModel):
    name: str
    season: int
    team_count: int = 12
    rules: Optional[LeagueRules] = None
    preset_id: Optional[str] = "salary_cap_auction_v1"
    commissioner_team_name: Optional[str] = "Commissioner"
    test_mode: bool = False


class LeagueJoinRequest(BaseModel):
    room_code: str
    team_name: str


class LeagueInviteCreateRequest(BaseModel):
    email: str
    team_name: str
    co_commissioner: bool = False


class LeagueInviteAcceptRequest(BaseModel):
    token: str


class TeamCoCommissionerRequest(BaseModel):
    enabled: bool


class ChatMessageCreateRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


class DraftNominateRequest(BaseModel):
    player_id: str
    player_name: str
    team: str = ""
    position: str
    fair_value: Optional[float] = None
    season_proj: Optional[float] = None
    per_game_proj: Optional[float] = None


class DraftBidRequest(BaseModel):
    amount: float


class DraftCutRequest(BaseModel):
    player_id: str


class RookieExtendRequest(BaseModel):
    """Manager rookie-extension command — years only; salary is server-calculated."""

    player_id: str
    extension_years: int = 1


class ContractExtendRequest(BaseModel):
    """Legacy alias for RookieExtendRequest. ``new_salary`` is ignored."""

    player_id: str
    extension_years: int
    new_salary: Optional[float] = None


class ContractRenewRequest(BaseModel):
    """Legacy alias for RookieExtendRequest. ``start_salary`` is ignored."""

    player_id: str
    extension_years: int = 1
    start_salary: Optional[float] = None


class TradeSwapRequest(BaseModel):
    player_id_a: str
    player_id_b: str


class LeagueTradeRequest(BaseModel):
    team_a_id: str
    team_b_id: str
    send_a: list[str] = Field(default_factory=list)
    send_b: list[str] = Field(default_factory=list)


class TradeSendLeg(BaseModel):
    player_id: str
    to_team_id: str


class TradePartyInput(BaseModel):
    team_id: str
    sends: list[Union[TradeSendLeg, str]] = Field(default_factory=list)
    drops: list[str] = Field(default_factory=list)


class DeadCapAssignment(BaseModel):
    player_id: str
    from_team_id: str
    assigned_to_team_id: str
    amount: Optional[float] = None


class TradeProposalCreate(BaseModel):
    parties: list[TradePartyInput]
    dead_cap_assignments: list[DeadCapAssignment] = Field(default_factory=list)
    note: Optional[str] = None
    validate_only: bool = False


class TradeProposalRespond(BaseModel):
    approve: bool = True


class LeagueSheetImportRequest(BaseModel):
    manager_team_name: Optional[str] = None
    replace_sleeper_sourced: bool = True


class TestDraftSetupRequest(BaseModel):
    bot_count: int = 3
    bot_budget: Optional[float] = None


class SimulateDraftRequest(BaseModel):
    max_picks: Optional[int] = None


class DraftContractItem(BaseModel):
    player_id: str
    contract_years: int = 1


class DraftContractsRequest(BaseModel):
    contracts: list[DraftContractItem]


class MockDraftStartRequest(BaseModel):
    mode: Literal["quick_bots", "league_mirror", "keeper_sandbox"]
    season: int = 2025
    team_count: int = 12
    bot_count: int = 7
    source_league_id: Optional[str] = None
    auto_start: bool = True
    name: Optional[str] = None


class SleeperImportRequest(BaseModel):
    sleeper_league_id: str
    team_id: Optional[str] = None
    import_to_hub: bool = True


class SleeperLinkRequest(BaseModel):
    sleeper_league_id: str
    sleeper_roster_id: str
    sleeper_team_name: Optional[str] = None


class SleeperTeamMapping(BaseModel):
    sleeper_roster_id: str
    hub_team_id: Optional[str] = None
    team_name: Optional[str] = None


class SleeperLeagueConnectRequest(BaseModel):
    sleeper_league_id: str
    mappings: Optional[list[SleeperTeamMapping]] = None
    commissioner_sleeper_roster_id: Optional[str] = None


class SleeperSyncRequest(BaseModel):
    import_to_hub: bool = False


class DraftPlayerHint(BaseModel):
    player_id: str
    player_name: Optional[str] = None
    team: Optional[str] = None
    position: Optional[str] = None


class DraftPoolModeRequest(BaseModel):
    pool_mode: str = "full"


class DraftEnrichmentRequest(BaseModel):
    season: Optional[int] = None
    week: Optional[int] = None
    players: list[DraftPlayerHint] = Field(default_factory=list)
    llm_player_ids: list[str] = Field(default_factory=list)
