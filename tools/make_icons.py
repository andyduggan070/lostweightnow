#!/usr/bin/env python3
"""Generate the LostWeightNow app icons (PNG) using only the stdlib.

Design: teal->green diagonal gradient with a white descending trend line,
echoing the weight chart in the app.
"""
import os
import struct
import zlib


def png_chunk(tag, data):
    chunk = tag + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk))


def write_png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y]) for y in range(size))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(png_chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(png_chunk(b"IEND", b""))


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg2))
    cx, cy = x1 + t * dx, y1 + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def make_icon(size):
    top = (13, 148, 136)      # teal-600
    bottom = (5, 95, 70)      # darker teal/green
    # trend line vertices in unit coords (descending, with a small bump)
    verts = [(0.18, 0.32), (0.40, 0.48), (0.55, 0.40), (0.82, 0.72)]
    pts = [(x * size, y * size) for x, y in verts]
    thick = size * 0.045
    dot_r = size * 0.065

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            f = (x + y) / (2 * size)
            r = int(top[0] + (bottom[0] - top[0]) * f)
            g = int(top[1] + (bottom[1] - top[1]) * f)
            b = int(top[2] + (bottom[2] - top[2]) * f)

            d = min(
                dist_to_segment(x, y, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1)
            )
            dd = min(((x - px) ** 2 + (y - py) ** 2) ** 0.5 - dot_r for px, py in (pts[0], pts[-1]))
            d = min(d - thick, dd)
            if d < 0:
                a = min(1.0, -d / max(1.0, size * 0.01))  # soft edge
                r = int(r + (255 - r) * a)
                g = int(g + (255 - g) * a)
                b = int(b + (255 - b) * a)
            row += bytes((r, g, b, 255))
        rows.append(row)
    return rows


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out, exist_ok=True)
    for size in (180, 192, 512):
        write_png(os.path.join(out, f"icon-{size}.png"), size, make_icon(size))
        print(f"icons/icon-{size}.png")


if __name__ == "__main__":
    main()
