"""Hub identity media variants snap to painted widths and cache WebP."""

from io import BytesIO
from pathlib import Path

from PIL import Image

from src.draft_hub.hub_media import (
    MEDIA_VARIANT_WIDTHS,
    resolve_hub_media_file,
    snap_variant_width,
    variant_path,
)


def test_snap_variant_width_buckets():
    assert snap_variant_width(None) is None
    assert snap_variant_width("") is None
    assert snap_variant_width(0) is None
    assert snap_variant_width(-1) is None
    assert snap_variant_width(22) == 48
    assert snap_variant_width(48) == 48
    assert snap_variant_width(84) == 96
    assert snap_variant_width(96) == 96
    assert snap_variant_width(200) == 256
    assert snap_variant_width(1600) == 256
    assert MEDIA_VARIANT_WIDTHS == (48, 96, 256)


def _png(path: Path, width=1600, height=1138):
    Image.new("RGB", (width, height), (20, 40, 80)).save(path, format="PNG")


def test_resolve_writes_cached_webp_and_does_not_upscale(tmp_path):
    original = tmp_path / "logo.bin"
    _png(original)
    media = {"path": original, "content_type": "image/png"}

    path, content_type = resolve_hub_media_file(media, 84)
    assert content_type == "image/webp"
    assert path == variant_path(original, 96)
    assert path.exists()
    with Image.open(path) as img:
        assert img.size[0] == 96
        assert img.size[1] < 96
    assert path.stat().st_size < original.stat().st_size

    again, _ = resolve_hub_media_file(media, 90)
    assert again == path

    tiny = tmp_path / "tiny.bin"
    _png(tiny, width=40, height=30)
    raw, ctype = resolve_hub_media_file({"path": tiny, "content_type": "image/png"}, 96)
    assert raw == tiny
    assert ctype == "image/png"


def test_corrupt_bytes_fall_back_to_original(tmp_path):
    original = tmp_path / "bad.bin"
    original.write_bytes(b"\xff\xd8\xff" + b"\x00" * 32)
    path, content_type = resolve_hub_media_file(
        {"path": original, "content_type": "image/jpeg"},
        96,
    )
    assert path == original
    assert content_type == "image/jpeg"


def test_transparent_png_keeps_alpha_in_webp(tmp_path):
    original = tmp_path / "mark.bin"
    img = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    for x in range(40, 120):
        for y in range(40, 120):
            img.putpixel((x, y), (20, 180, 120, 255))
    img.save(original, format="PNG")
    path, content_type = resolve_hub_media_file(
        {"path": original, "content_type": "image/png"},
        48,
    )
    assert content_type == "image/webp"
    with Image.open(path) as out:
        converted = out.convert("RGBA")
        assert converted.getpixel((0, 0))[3] == 0
        assert converted.getpixel((24, 24))[3] == 255


def test_png_bytes_round_trip_for_api_fixture():
    buf = BytesIO()
    Image.new("RGB", (64, 48), (8, 16, 24)).save(buf, format="PNG")
    assert buf.getvalue()[:8] == b"\x89PNG\r\n\x1a\n"
