"""Generate placeholder PWA icons for ScoreSense (dark tile + SS mark)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public"


def _chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _png_rgba(width: int, height: int, pixels: bytes) -> bytes:
    raw = b"".join(b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(b"IHDR", ihdr),
            _chunk(b"IDAT", zlib.compress(raw, 9)),
            _chunk(b"IEND", b""),
        ]
    )


def _fill(size: int) -> bytes:
  bg = (11, 18, 32, 255)
  accent = (59, 130, 246, 255)
  muted = (96, 165, 250, 255)
  pixels = bytearray(size * size * 4)
  cx, cy = size // 2, size // 2
  bar_w = max(2, size // 16)
  gap = max(3, size // 12)
  heights = [0.35, 0.55, 0.75, 0.95]
  base_y = int(size * 0.72)
  for y in range(size):
    for x in range(size):
      i = (y * size + x) * 4
      color = bg
      # rounded rect feel via corner fade
      dx = min(x, size - 1 - x) / (size * 0.08)
      dy = min(y, size - 1 - y) / (size * 0.08)
      if dx < 1 or dy < 1:
        t = max(dx, dy)
        color = tuple(max(0, min(255, int(bg[c] * t + accent[c] * (1 - t)))) for c in range(3)) + (255,)
      # bar chart marks
      for idx, h in enumerate(heights):
        bx = int(size * 0.22) + idx * (bar_w + gap)
        top = int(base_y - size * h * 0.42)
        if bx <= x < bx + bar_w and top <= y <= base_y:
          color = accent if idx % 2 == 0 else muted
      # SS text block (simple pixels)
      if int(size * 0.18) <= y <= int(size * 0.34):
        if int(size * 0.58) <= x <= int(size * 0.82):
          color = (241, 245, 249, 255)
      pixels[i : i + 4] = bytes(color)
  return bytes(pixels)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("pwa-192.png", 192), ("pwa-512.png", 512), ("apple-touch-icon.png", 180)):
        path = OUT / name
        path.write_bytes(_png_rgba(size, size, _fill(size)))
        print("wrote", path)
    # minimal 32x32 favicon
    fav = OUT / "favicon.ico"
    png32 = _png_rgba(32, 32, _fill(32))
    # ICO with embedded PNG (Vista+)
    fav.write_bytes(
        struct.pack("<HHH", 0, 1, 1)
        + struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png32), 6 + 16)
        + png32
    )
    print("wrote", fav)


if __name__ == "__main__":
    main()
