"""Project paths and constants."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

_INSECURE_JWT_DEFAULT = "change-me-in-production"
_TEST_JWT_FALLBACK = "test-suite-secure-fallback-token-string-for-pytest-only"


def is_testing() -> bool:
    return os.getenv("TESTING", "0") == "1" or os.getenv("SCORESENSE_TESTING", "0") == "1"


# Keys from .env always win — avoids stale shell env blocking local HUB_AUTH_REQUIRED=false.
_DOTENV_OVERRIDE_KEYS = frozenset({"AUTH_REQUIRED", "HUB_AUTH_REQUIRED", "HUB_TIMING"})


def _load_dotenv() -> None:
    """Load project .env into os.environ without overriding existing vars."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (key not in os.environ or key in _DOTENV_OVERRIDE_KEYS):
            os.environ[key] = value


_load_dotenv()


def _resolve_jwt_secret() -> str:
    raw = os.getenv("JWT_SECRET", "")
    if is_testing():
        if raw and raw != _INSECURE_JWT_DEFAULT:
            return raw
        return _TEST_JWT_FALLBACK
    if not raw or raw == _INSECURE_JWT_DEFAULT:
        raise ValueError(
            "CRITICAL SECURITY VIOLATION: JWT_SECRET environment variable is missing or insecure."
        )
    return raw


# Auth & OAuth — read here; do not use os.environ.get() in routes or app/auth.py
PATREON_CLIENT_ID = os.getenv("PATREON_CLIENT_ID", "")
PATREON_CLIENT_SECRET = os.getenv("PATREON_CLIENT_SECRET", "")
PATREON_REDIRECT_URI = os.getenv(
    "PATREON_REDIRECT_URI",
    "http://127.0.0.1:8000/api/auth/patreon/callback",
)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:8000/api/auth/google/callback",
)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
PATREON_CAMPAIGN_ID = os.getenv("PATREON_CAMPAIGN_ID", "")
JWT_SECRET = _resolve_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_DAYS = int(os.getenv("JWT_DAYS", "14"))
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() in ("1", "true", "yes")
HUB_AUTH_REQUIRED = os.getenv("HUB_AUTH_REQUIRED", "false").lower() in ("1", "true", "yes")
HUB_DEMO_LEAGUE_ID = os.getenv("HUB_DEMO_LEAGUE_ID", "").strip()
HUB_TIMING = os.getenv("HUB_TIMING", "false").lower() in ("1", "true", "yes")
PATREON_MIN_CENTS = int(os.getenv("PATREON_MIN_CENTS", "100"))
# Android TWA signing cert SHA-256 (colon-separated, from Bubblewrap keystore). Empty = omit from assetlinks.
TWA_SHA256_FINGERPRINT = os.getenv("TWA_SHA256_FINGERPRINT", "").strip()
TWA_PACKAGE_NAME = os.getenv("TWA_PACKAGE_NAME", "com.fourthdownlabs.scoresense").strip()

ADMIN_EMAILS = frozenset(
    e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()
)

# Transactional email (invites, verification, password reset)
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or "noreply@scoresense.app").strip()
SMTP_TLS = os.getenv("SMTP_TLS", "true").lower() in ("1", "true", "yes")

# Legal — linked from auth UI and register consent (defaults to in-app pages)
TERMS_URL = os.getenv("TERMS_URL", f"{FRONTEND_URL.rstrip('/')}/terms").strip()
PRIVACY_URL = os.getenv("PRIVACY_URL", f"{FRONTEND_URL.rstrip('/')}/privacy").strip()
TERMS_VERSION = os.getenv("TERMS_VERSION", "2026-09").strip()

DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
CACHE_DIR = DATA_DIR / "cache"

LEGACY_MODEL_DIR = PROJECT_ROOT / "legacy" / "data" / "Model"
MODEL_DIR = PROJECT_ROOT / "artifacts" / "models" / "v2"
LEGACY_PREDICTIONS_DIR = PROJECT_ROOT / "legacy" / "data" / "Predictions"
PREDICTIONS_DIR = PROJECT_ROOT / "artifacts" / "predictions"
DRAFT_POOL_DIR = PROJECT_ROOT / "artifacts" / "draft_pool"
WEEKLY_PREDICTIONS_DIR = PROJECT_ROOT / "artifacts" / "weekly_predictions"
WEEKLY_PROJECTION_CHANGES_DIR = PROJECT_ROOT / "artifacts" / "weekly_projection_changes"
ROS_PREDICTIONS_DIR = PROJECT_ROOT / "artifacts" / "ros_predictions"
PLAYER_CONTEXT_DIR = PROJECT_ROOT / "artifacts" / "player_context"
INJURY_OVERLAYS_DIR = PROJECT_ROOT / "artifacts" / "injury_overlays"
INJURY_SNAPSHOTS_DIR = CACHE_DIR / "injury_snapshots"
# SCORE-31: skip rapid overlay recomputes unless force=True.
INJURY_OVERLAY_DEBOUNCE_SECONDS = int(
    os.environ.get("INJURY_OVERLAY_DEBOUNCE_SECONDS", "60")
)
# SCORE-33: adaptive centralized Sleeper injury poll cadence (seconds).
INJURY_POLL_STATUS_PATH = CACHE_DIR / "injury_poll_status.json"
INJURY_POLL_REPORTING_SECONDS = int(
    os.environ.get("INJURY_POLL_REPORTING_SECONDS", str(8 * 60))
)  # game / injury-report windows
INJURY_POLL_INSEASON_SECONDS = int(
    os.environ.get("INJURY_POLL_INSEASON_SECONDS", str(45 * 60))
)  # normal in-season
INJURY_POLL_OFFSEASON_SECONDS = int(
    os.environ.get("INJURY_POLL_OFFSEASON_SECONDS", str(3 * 3600))
)  # off / pre
INJURY_POLL_MANUAL_COOLDOWN_SECONDS = int(
    os.environ.get("INJURY_POLL_MANUAL_COOLDOWN_SECONDS", "120")
)
BACKTEST_DIR = PROJECT_ROOT / "artifacts" / "backtest"
BACKTEST_CACHE_DIR = CACHE_DIR / "backtest_models"
BACKTEST_CHECKPOINT_VERSION = "v1"
ANALYTICS_DIR = PROJECT_ROOT / "artifacts" / "analytics"
CANDIDATE_DATA_DIR = DATA_DIR / "candidates"
PROJECTIONS_DATA_DIR = DATA_DIR / "projections"
ROOKIE_ROLE_OVERRIDES_PATH = PROJECTIONS_DATA_DIR / "rookie_role_overrides.yaml"
SENTIMENT_DIR = DATA_DIR / "sentiment"
SENTIMENT_CACHE_DIR = CACHE_DIR / "sentiment"
SENTIMENT_FEATURES_PATH = CANDIDATE_DATA_DIR / "sentiment_features.parquet"
DRAFT_HUB_DIR = DATA_DIR / "draft_hub"
DRAFT_HUB_DB = DRAFT_HUB_DIR / "draft_hub.db"
DRAFT_HUB_PRESETS_DIR = DRAFT_HUB_DIR / "presets"
MANAGER_TEAM_MAP_PATH = DRAFT_HUB_DIR / "manager_team_map.yaml"
DRAFT_WINNER_ALIASES_PATH = DRAFT_HUB_DIR / "draft_winner_aliases.yaml"
LEAGUE_DRAFT_SOURCES_PATH = DRAFT_HUB_DIR / "league_draft_sources.yaml"
OLD_LEAGUE_FILES_DIR = PROJECT_ROOT / "old_league_files"
LEAGUE_CONTRACT_HISTORY_DIR = DATA_DIR / "league_contract_history"
AUTH_DIR = DATA_DIR / "auth"
AUTH_DB = AUTH_DIR / "users.db"
BDB_DIR = PROJECT_ROOT / "artifacts" / "bdb"
NGS_RAW_DIR = DATA_DIR / "raw" / "ngs"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"

# Quantile levels for prediction intervals (P10 / P50 / P90)
PREDICTION_QUANTILES = (0.1, 0.5, 0.9)

# WR P90 calibration artifact (boom-weight τ=0.9 only; P50 unchanged)
WR_CALIBRATED_MODEL_BUNDLE = "wr_model_calibrated.joblib"
RB_CALIBRATED_MODEL_BUNDLE = "rb_model_calibrated.joblib"

LEGACY_TRAIN_DIR = PROJECT_ROOT / "legacy" / "data" / "TrainData"
LEGACY_PFF_DIR = PROJECT_ROOT / "legacy" / "data" / "PFFData"

POSITIONS = ("qb", "rb", "wr")

# Standard PPR scoring weights (used when nflverse column unavailable)
FANTASY_SCORING = {
    "passing_yards": 0.04,
    "passing_tds": 4.0,
    "interceptions": -2.0,
    "rushing_yards": 0.1,
    "rushing_tds": 6.0,
    "receptions": 1.0,
    "receiving_yards": 0.1,
    "receiving_tds": 6.0,
    "fumbles_lost": -2.0,
}

# Seasons used for default training/backtest
DEFAULT_TRAIN_SEASONS = list(range(2018, 2025))
DEFAULT_TEST_SEASONS = [2025]
DEFAULT_ETL_SEASONS = DEFAULT_TRAIN_SEASONS + DEFAULT_TEST_SEASONS
DEFAULT_ACCURACY_SEASONS = list(range(2019, 2026))
DEFAULT_FP_ARCHIVE_SEASONS = list(range(2019, 2026))

# Boom-week thresholds (PPR fantasy points)
BOOM_THRESHOLDS: dict[str, float] = {"qb": 25.0, "rb": 20.0, "wr": 20.0}

# Composite score weights for feature promotion (lower composite = better)
COMPOSITE_MAE_WEIGHT = 0.6
COMPOSITE_BOOM_WEIGHT = 0.4

# Draft season totals: games assumed per player (bye-week MVP)
GAMES_PER_SEASON = 17

# Preseason season-long: optional FP consensus blend in production (eval tunes β per position)
PRESEASON_FP_BLEND_ENABLED = os.getenv("PRESEASON_FP_BLEND_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes",
)
PRESEASON_USE_EXPECTED_GAMES = os.getenv("PRESEASON_USE_EXPECTED_GAMES", "true").lower() in (
    "1",
    "true",
    "yes",
)

# SCORE-2: schedule-aware correlated MC season P10/P50/P90 aggregation.
# "mc_schedule_v1" (default) replaces the naive weekly-quantile x GAMES_PER_SEASON scale;
# "independent_scale" keeps the legacy behavior for A/B comparison.
SEASON_QUANTILE_METHOD = os.getenv("SEASON_QUANTILE_METHOD", "mc_schedule_v1").strip().lower()

# Beat digest / OpenAI (read here — not os.environ in sentiment modules)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BEAT_DIGEST_LLM_ENABLED = os.getenv("BEAT_DIGEST_LLM_ENABLED", "true").lower() in ("1", "true", "yes")
BEAT_DIGEST_LLM_TOP_N = int(os.getenv("BEAT_DIGEST_LLM_TOP_N", "40"))
BEAT_DIGEST_PREWARM_TOP_N = int(os.getenv("BEAT_DIGEST_PREWARM_TOP_N", "200"))
# Bump when digest logic changes so stale file cache is not reused.
BEAT_DIGEST_CACHE_VERSION = os.getenv("BEAT_DIGEST_CACHE_VERSION", "v2")

# Compressed Parquet defaults for mlready / cache writes (zstd ≈ 3–5× smaller than CSV)
PARQUET_WRITE_KWARGS = {"index": False, "compression": "zstd"}


def write_parquet(df, path) -> None:
    """Write a DataFrame to compressed Parquet."""
    df.to_parquet(path, **PARQUET_WRITE_KWARGS)

for path in (
    PROCESSED_DATA_DIR,
    CACHE_DIR,
    BACKTEST_CACHE_DIR,
    MODEL_DIR,
    PREDICTIONS_DIR,
    BACKTEST_DIR,
    ANALYTICS_DIR,
    CANDIDATE_DATA_DIR,
    SENTIMENT_DIR,
    SENTIMENT_CACHE_DIR,
    DRAFT_HUB_DIR,
    BDB_DIR,
    NGS_RAW_DIR,
    PLAYER_CONTEXT_DIR,
    INJURY_OVERLAYS_DIR,
    INJURY_SNAPSHOTS_DIR,
):
    path.mkdir(parents=True, exist_ok=True)
