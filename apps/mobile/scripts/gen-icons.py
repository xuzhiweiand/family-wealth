"""Generate launcher / splash PNGs from the 1024px brand icon.

Why this exists: the dev sandbox cannot install Pillow (pip blocked) and the
pnpm store has no `sharp`, so `expo prebuild` cannot resize the icon here.
This script is a zero-dependency replacement:
  - PNG decode:  zlib inflate + per-row unfilter (filters 0..4)
  - downscale:   box / area average (good anti-aliasing for big ratios)
  - PNG encode:  filter-0 rows + zlib deflate

Usage:
    python scripts/gen-icons.py

Inputs:   assets/brand/jiazi-icon-v4.png   (1024x1024 source, Android launcher)
          assets/icon.png                  (1024x1024 brand tile, Harmony splash)
Outputs:  android/app/src/main/res/mipmap-<density>/ic_launcher.png
          android/app/src/main/res/mipmap-<density>/ic_launcher_round.png
          harmony/.../resources/base/media/splash_icon.png

splash_icon：HarmonyOS startWindowBackground 是品牌绿 #10B981，若启动图直接用
带绿色底的品牌方块，方块绿与背景绿不一致，会看到一块突兀的方贴（旧图还带 AI
水印）。这里把品牌图里的「白色圆盘 + 绿色标志」抠到透明底上，启动时图标自然
浮在同色背景上，水印位于圆盘外一并被透明剔除。

Note: `expo prebuild` writes .webp launcher icons. PNG and .webp with the same
resource name collide in AAPT2 ("duplicate value for resource"), so after
running this script delete any leftover `ic_launcher*.webp` under mipmap-*.
"""

import os
import struct
import zlib

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(_HERE, "..", "assets", "brand", "jiazi-icon-v4.png"))
SPLASH_SRC = os.path.normpath(os.path.join(_HERE, "..", "assets", "icon.png"))
SPLASH_OUT = os.path.normpath(
    os.path.join(
        _HERE,
        "..",
        "harmony",
        "entry",
        "src",
        "main",
        "resources",
        "base",
        "media",
        "splash_icon.png",
    )
)
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


# ------------------------------------------------- Harmony splash icon
def extract_disc_on_transparent(rgba, w, h):
    """Extract the white brand disc onto a transparent canvas.

    品牌图 = 渐变绿底 + 居中白色圆盘 + 绿色标志。按近白像素包围盒自动识别圆盘
    圆心与半径；圆内保留原色（白盘 + 标志），边缘约 3px 用纯白按覆盖率输出，
    避免原图抗锯齿混入的旧绿色在 #10B981 背景上留下暗圈；圆外全透明
    （角落水印也随之消失）。输出尺寸与输入一致。
    """
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            r, g, b = rgba[i], rgba[i + 1], rgba[i + 2]
            if r > 245 and g > 245 and b > 245:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("splash source has no white disc to extract")

    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    radius = min(max(xs) - min(xs), max(ys) - min(ys)) / 2.0

    out = bytearray(w * h * 4)
    for oy in range(h):
        for ox in range(w):
            inside = 0
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    dx = ox + sx - cx
                    dy = oy + sy - cy
                    if dx * dx + dy * dy <= radius * radius:
                        inside += 1
            i = (oy * w + ox) * 4
            if inside == 4:
                # 圆内深区直接沿用原图；距边缘 2px 内一律铺白，吃掉旧绿边
                dx = ox + 0.5 - cx
                dy = oy + 0.5 - cy
                d = (dx * dx + dy * dy) ** 0.5
                if d <= radius - 2.0:
                    out[i] = rgba[i]
                    out[i + 1] = rgba[i + 1]
                    out[i + 2] = rgba[i + 2]
                    out[i + 3] = 255
                else:
                    out[i] = out[i + 1] = out[i + 2] = 255
                    out[i + 3] = 255
            elif inside > 0:
                out[i] = out[i + 1] = out[i + 2] = 255
                out[i + 3] = 255 * inside // 4
            # else: 全透明
    return w, h, out


def gen_splash():
    w, h, nch, pixels = read_png(SPLASH_SRC)
    print(f"splash source: {SPLASH_SRC} -> {w}x{h}, {nch} channels")
    base_rgba = to_rgba(pixels, w, h, nch)
    sw, sh, splash_rgba = extract_disc_on_transparent(base_rgba, w, h)
    write_png(SPLASH_OUT, sw, splash_rgba)
    print(f"  {os.path.relpath(SPLASH_OUT, _HERE)}: {sw}x{sh} (transparent bg)")


# ---------------------------------------------------------------- main
def main():
    # Harmony splash always runs (only needs assets/icon.png).
    gen_splash()

    # Android launcher icons need the clean brand source, which is not always
    # present in this repo; skip with a warning instead of crashing after the
    # splash icon has already been generated.
    if not os.path.exists(SRC):
        print(f"[gen-icons] skip Android launcher icons (missing: {os.path.relpath(SRC, _HERE)})")
        return

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
