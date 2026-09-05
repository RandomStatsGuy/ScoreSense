"""Hub identity media variants — serve the size the UI paints.

GET /api/hub/media/{id}?w=48|96|256 snaps to those widths, writes a WebP
next to the original, and returns the cached file on later hits.
Corrupt or tiny uploads fall back to the original bytes so crop/studio
and existing tests keep working.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MEDIA_VARIANT_WIDTHS = (48, 96, 256)
VARIANT_CONTENT_TYPE = "image/webp"


def snap_variant_width(raw: Any) -> int | None:
    """Map a requested width onto 48 / 96 / 256. None means the original."""
    if raw is None or raw == "":
        return None
    try:
        width = int(raw)
    except (TypeError, ValueError):
        return None
    if width <= 0:
        return None
    for allowed in MEDIA_VARIANT_WIDTHS:
        if width <= allowed:
            return allowed
    return MEDIA_VARIANT_WIDTHS[-1]


def variant_path(original: Path, width: int) -> Path:
    return original.with_name(f"{original.stem}.w{width}.webp")


def resolve_hub_media_file(media: dict[str, Any], width: Any = None) -> tuple[Path, str]:
    """Return (path, content_type) for the original or a snapped variant."""
    original = Path(media["path"])
    content_type = str(media.get("content_type") or "application/octet-stream")
    snapped = snap_variant_width(width)
    if snapped is None:
        return original, content_type
    dest = variant_path(original, snapped)
    if dest.exists() and dest.stat().st_size > 0:
        return dest, VARIANT_CONTENT_TYPE
    built = _write_variant(original, dest, snapped)
    if built:
        return dest, VARIANT_CONTENT_TYPE
    return original, content_type


def _write_variant(original: Path, dest: Path, width: int) -> bool:
    try:
        from PIL import Image
    except ImportError:
        logger.warning("Pillow is not installed; serving original hub media")
        return False
    try:
        with Image.open(original) as img:
            src_w, src_h = img.size
            if src_w <= 0 or src_h <= 0:
                return False
            if src_w <= width:
                return False
            height = max(1, round(src_h * (width / src_w)))
            # Keep logo/headshot alpha. RGB flatten turns transparent pixels black.
            has_alpha = img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            )
            work = img.convert("RGBA") if has_alpha else img.convert("RGB")
            resized = work.resize((width, height), Image.Resampling.LANCZOS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            resized.save(tmp, format="WEBP", quality=80, method=4)
            tmp.replace(dest)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        logger.exception("hub media variant failed for %s w=%s", original, width)
        try:
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        return False
