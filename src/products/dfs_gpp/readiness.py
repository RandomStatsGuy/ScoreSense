"""Fail-closed policy for future artifact/API integration, not model validation.

Evidence must be derived by a trusted server-side artifact reader. Never accept
these booleans from a client as proof that an objective is production-ready.
"""

from __future__ import annotations

from dataclasses import dataclass, fields


@dataclass(frozen=True)
class ReadinessEvidence:
    legal_slate_and_salary_ids: bool = False
    legacy_projections_available: bool = False
    verified_rule_and_scoring_profile: bool = False
    fresh_inputs: bool = False
    full_distributions_available: bool = False
    dependence_validated: bool = False
    all_field_players_supported: bool = False
    dst_distribution_supported: bool = False
    kicker_distribution_supported: bool = False
    ownership_complete: bool = False
    joint_field_model_available: bool = False
    complete_cash_payouts: bool = False
    held_out_football_validation: bool = False
    held_out_field_validation: bool = False
    payout_validation: bool = False
    contest_family_validation: bool = False

    def __post_init__(self) -> None:
        for item in fields(self):
            if type(getattr(self, item.name)) is not bool:
                raise TypeError(f"{item.name} must be a boolean")


@dataclass(frozen=True)
class ReadinessReport:
    requested_capability: str
    available_capabilities: tuple[str, ...]
    blocking_reasons: tuple[str, ...]

    @property
    def allowed(self) -> bool:
        return not self.blocking_reasons

    @property
    def effective_capability(self) -> str | None:
        # Never silently fulfill expected payout with a score-only objective.
        return self.requested_capability if self.allowed else None


class CapabilityUnavailable(ValueError):
    def __init__(self, report: ReadinessReport) -> None:
        self.report = report
        super().__init__("; ".join(report.blocking_reasons))


def assess_readiness(
    evidence: ReadinessEvidence,
    *,
    game_style: str,
    requested_capability: str,
) -> ReadinessReport:
    """Keep legacy, joint-score, research and validated claims distinct.

    Showdown requires kicker coverage; do not achieve readiness by pruning
    legal field players. Late swap is intentionally unavailable in this phase.
    Site/slate/profile compatibility must be verified by the artifact adapter.
    """
    if game_style not in ("classic", "showdown"):
        raise ValueError("unsupported GPP game_style")
    base = ("legal_slate_and_salary_ids",)
    joint = base + (
        "verified_rule_and_scoring_profile", "fresh_inputs",
        "full_distributions_available", "dependence_validated",
        "all_field_players_supported", "dst_distribution_supported",
    )
    if game_style == "showdown":
        joint += ("kicker_distribution_supported",)
    research = joint + (
        "ownership_complete", "joint_field_model_available", "complete_cash_payouts",
    )
    validated = research + (
        "held_out_football_validation", "held_out_field_validation",
        "payout_validation", "contest_family_validation",
    )
    requirements = {
        "legacy_projection": base + ("legacy_projections_available",),
        "joint_score_model": joint,
        "contest_research": research,
        "contest_validated": validated,
    }
    if requested_capability not in (*requirements, "late_swap_ready"):
        raise ValueError("unknown requested_capability")
    missing = {
        capability: tuple(f"missing:{name}" for name in names if not getattr(evidence, name))
        for capability, names in requirements.items()
    }
    available = tuple(key for key, reasons in missing.items() if not reasons)
    reasons = (
        ("late_swap_not_implemented",)
        if requested_capability == "late_swap_ready" else missing[requested_capability]
    )
    return ReadinessReport(requested_capability, available, reasons)


def require_capability(
    evidence: ReadinessEvidence, *, game_style: str, requested_capability: str,
) -> ReadinessReport:
    report = assess_readiness(evidence, game_style=game_style, requested_capability=requested_capability)
    if not report.allowed:
        raise CapabilityUnavailable(report)
    return report
