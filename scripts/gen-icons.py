#!/usr/bin/env python3
"""Generate the add-in icon PNGs (solid accent rounded square) with zero deps.
Writes dist/assets/icon-{16,32,80}.png and also src/assets/ for the repo."""
import struct, zlib, os, math

ACCENT = (0, 122, 255)  # #007aff

def write_png(path, size, color, radius_frac=0.2):
    def px(x, y):
        # rounded-square alpha
        cx = cy = (size - 1) / 2
        r = size * radius_frac
        # distance from center to corner region
        dx = max(abs(x - cx) - (cx - r + 1), 0)
        dy = max(abs(y - cy) - (cy - r + 1), 0)
        dist = math.hypot(dx, dy)
        if dist <= r - 0.5:
            a = 255
        elif dist <= r + 0.5:
            a = max(0, min(255, int(255 * (r + 0.5 - dist))))
        else:
            a = 0
        R, G, B = color
        return R, G, B, a
    raw = b""
    for y in range(size):
        raw += b"\x00"
        for x in range(size):
            R, G, B, a = px(x, y)
            raw += bytes((R, G, B, a))
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(sig + ihdr + idat + iend)
    print("wrote", path, f"{os.path.getsize(path)}B")

for base in ("src/assets", "dist/assets"):
    os.makedirs(base, exist_ok=True)
    for size in (16, 32, 80):
        write_png(os.path.join(base, f"icon-{size}.png"), size, ACCENT)