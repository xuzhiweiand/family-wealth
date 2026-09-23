"""Generate Android launcher PNGs from the 1024px brand icon.

Why this exists: the dev sandbox cannot install Pillow (pip blocked) and the
pnpm store has no `sharp`, so `expo prebuild` cannot resize the icon here.
This script is a zero-dependency replacement:
  - PNG decode:  zlib inflate + per-row unfilter (filters 0..4)
  - downscale:   box / area average (good anti-aliasing for big ratios)
  - PNG encode:  filter-0 rows + zlib deflate

Usage:
    python scripts/gen-icons.py

Inputs:   assets/brand/jiazi-icon-v4.png   (1024x1024 source)
Outputs:  android/app/src/main/res/mipmap-<density>/ic_launcher.png
          android/app/src/main/res/mipmap-<density>/ic_launcher_round.png

Note: `expo prebuild` writes .webp launcher icons. PNG and .webp with the same
resource name collide in AAPT2 ("duplicate value for resource"), so after
running this script delete any leftover `ic_launcher*.webp` under mipmap-*.
"""

import os
import struct
import zlib

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(_HERE, "..", "assets", "brand", "jiazi-icon-v4.png"))
RES = os.path.normpath(os.path.join(_HERE, "..", "android", "app", "src", "main", "res"))

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


# ---------------------------------------------------------------- PNG decode
def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat = 8, bytearray()
    width = height = nch = 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, depth, color, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8, f"unsupported bit depth {depth}"
            assert interlace == 0, "interlaced PNG unsupported"
            nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break

    raw = zlib.decompress(bytes(idat))
    stride = width * nch
    out = bytearray(height * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ftype == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                if i >= nch:
                    a = line[i - nch]
                    c = prev[i - nch]
                else:
                    a = c = 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                if pa <= pb and pa <= pc:
                    pred = a
                elif pb <= pc:
                    pred = b
                else:
                    pred = c
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return width, height, nch, out


# ---------------------------------------------------------------- resize
def to_rgba(pixels, w, h, nch):
    """Normalize any channel layout to a flat RGBA bytearray."""
    out = bytearray(w * h * 4)
    for i in range(w * h):
        s, d = i * nch, i * 4
        if nch >= 3:
            out[d] = pixels[s]
            out[d + 1] = pixels[s + 1]
            out[d + 2] = pixels[s + 2]
            out[d + 3] = pixels[s + 3] if nch == 4 else 255
        elif nch == 2:  # gray + alpha
            out[d] = out[d + 1] = out[d + 2] = pixels[s]
            out[d + 3] = pixels[s + 1]
        else:  # gray
            out[d] = out[d + 1] = out[d + 2] = pixels[s]
            out[d + 3] = 255
    return out


def box_resize(rgba, w, h, size):
    """Area-average downscale to size x size (RGBA in, RGBA out)."""
    out = bytearray(size * size * 4)
    xr, yr = w / size, h / size
    for oy in range(size):
        y0 = int(oy * yr)
        y1 = max(y0 + 1, min(h, int((oy + 1) * yr)))
        for ox in range(size):
            x0 = int(ox * xr)
            x1 = max(x0 + 1, min(w, int((ox + 1) * xr)))
            r = g = b = a = n = 0
            for y in range(y0, y1):
                base = y * w * 4
                for x in range(x0, x1):
                    i = base + x * 4
                    r += rgba[i]
                    g += rgba[i + 1]
                    b += rgba[i + 2]
                    a += rgba[i + 3]
                    n += 1
            o = (oy * size + ox) * 4
            out[o] = r // n
            out[o + 1] = g // n
            out[o + 2] = b // n
            out[o + 3] = a // n
    return out


def apply_circle(rgba, size):
    """Zero alpha outside the inscribed circle (2x2 supersampled edge)."""
    r = size / 2.0
    out = bytearray(rgba)
    for oy in range(size):
        for ox in range(size):
            inside = 0
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    dx = ox + sx - r
                    dy = oy + sy - r
                    if dx * dx + dy * dy <= r * r:
                        inside += 1
            i = (oy * size + ox) * 4 + 3
            out[i] = out[i] * inside // 4
    return out


# ---------------------------------------------------------------- PNG encode
def write_png(path, size, rgba):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += rgba[y * size * 4 : (y + 1) * size * 4]

    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(blob)


# ---------------------------------------------------------------- main
def main():
    w, h, nch, pixels = read_png(SRC)
    print(f"source: {SRC} -> {w}x{h}, {nch} channels")
    base_rgba = to_rgba(pixels, w, h, nch)

    # downscale once to the largest target, then derive the smaller ones
    largest = max(DENSITIES.values())
    master = box_resize(base_rgba, w, h, largest)
    print(f"master {largest}x{largest} ready")

    for density, size in DENSITIES.items():
        small = master if size == largest else box_resize(master, largest, largest, size)
        folder = os.path.join(RES, f"mipmap-{density}")
        write_png(os.path.join(folder, "ic_launcher.png"), size, small)
        write_png(os.path.join(folder, "ic_launcher_round.png"), size, apply_circle(small, size))
        print(f"  mipmap-{density}: {size}px  ic_launcher.png + ic_launcher_round.png")


if __name__ == "__main__":
    main()
