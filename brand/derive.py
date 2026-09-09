#!/usr/bin/env python3
"""kenzen#89/#90/#92: derives real-alpha PNG/WebP cutouts from Kenzen's brand source images
-- roshne's direction for the whole brand epic was to use the artwork as-is, in its real
colours, not a hand-redrawn approximation. Each source rebuilds a real alpha channel from its
own background signature; the exact technique depends on what that background actually is.

- `brand/source/koi-teal.jpg` (kenzen#89): the Code Stream Koi mark, one subject filling the
  frame -- `derive_koi()`. A checkerboard baked in place of transparency (JPG has no alpha
  channel); background pixels are nearly perfectly desaturated (R almost equal to G almost
  equal to B) AND light -- the fish's navy/teal/mint palette is never both. Feathers the cut
  edge 2px, crops to the subject's own bounding box, and resizes into each target size.
- `brand/source/status-shields.jpg` (kenzen#90): three status shields (healthy/vulnerable/
  attention, left to right) side by side in one frame, also a checkerboard background --
  `derive_shields()` slices the frame into equal thirds first (each shield's own bounding-box
  crop then runs inside just its third, so one shield's content can never bleed into a
  neighbour's crop) and otherwise reuses `derive_koi()`'s exact checkerboard-removal
  technique. Each shield's inner ring (between the outer silhouette and the inner body) is
  genuine transparency in the source art, not a solid stroke -- confirmed by zooming into the
  source JPEG, where the same checkerboard pattern and phase as the true background shows
  through it -- so the plain per-pixel threshold already removes it correctly, letting it
  show whatever sits behind the rendered `<img>` (the theme's own background) rather than a
  hardcoded colour.
- `brand/source/koi-banner-light.jpg` (kenzen#92): roshne's "banner 5" -- a 1024x1024 JPEG,
  the koi and binary streams on a baked LIGHT checkerboard (~25px cells, tones ~237/~254),
  with a real dark outline around the koi this time (two earlier sources: `koi-banner-
  silver.jpg`'s dark checkerboard, kept in `brand/source/` for history but no longer derived
  from; and a flat-navy re-export, never committed at all -- it turned out unrecoverable at
  the edges, 4:2:0 JPEG chroma subsampling put the outline at the same colour as the
  background).
  `derive_banner()` is ported verbatim (numbers and all -- tuned by eye against this exact
  source, do not "improve" them without re-checking with roshne). No checker-grid model: the
  checker isn't a strict parity grid (a tile seam puts two light cells side by side, which
  would invert a fitted grid from there on). Instead:
    1. background candidates = neutral light grey (`lum >= BG_LUM_MIN`, channel spread
       `<= BG_CHROMA_MAX`)
    2. the koi body is the same grey, so it's protected by its dark outline: flood-fill from
       the image border through non-dark pixels; whatever that flood never reaches (and isn't
       adjacent to what it did reach) is "inside an outline" and forced opaque with its
       original colour, regardless of how background-like that colour looks
    3. everything else gets GIMP-style colour-to-alpha against a locally estimated background
       (box-blur inpainting of the background pixels, six passes), with a transparency
       threshold (`C2A_TRANSPARENT`, the JPEG noise floor) and an opacity threshold
       (`C2A_OPAQUE`: mid-grey glyphs and cyan fills keep their colour at alpha 1); in between,
       alpha is partial and the colour is un-matted so the sparkles' pale glow and the dashes'
       pale echo fade correctly against whatever sits behind the rendered `<img>`
    4. the un-matted colour may not drop below `FG_FLOOR` of the observed pixel -- otherwise a
       low-alpha pixel extrapolates towards black and leaves a dark rim
    5. crop to content plus a `CROP_MARGIN` px margin (1024x395 for this source)
  Gotcha ported along with the code: `ImageDraw.floodfill` silently no-ops on a `PIL.Image`
  created straight from a numpy array (Pillow 12.2) -- `_flood_from_border()`'s `.copy()` is
  load-bearing, not incidental; do not remove it as dead code.

Run with (Windows, this machine -- see the repo CLAUDE.md on Python invocation):
    py -3.12 brand/derive.py

Requires Pillow and numpy (not repo dependencies -- a one-off asset-derivation script, run
by hand when the source art changes, not part of any build).

Writes packages/web/public/brand/koi-{512,192,64,32}.png (transparent, the fish's own aspect
ratio centered in the square canvas), apple-touch-icon.png (180, same crop, but flattened onto
a solid navy background -- iOS doesn't compositing-blend a transparent touch icon, it can
render the empty area black instead, per Apple's own HIG),
shield-{healthy,vulnerable,attention}-{64,32}.png (each transparent, the source's own aspect
ratio centered in the square canvas), and koi-banner.png / koi-banner.webp (1024x395,
transparent, cropped to content plus margin).
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_KOI = REPO_ROOT / "brand" / "source" / "koi-teal.jpg"
SOURCE_SHIELDS = REPO_ROOT / "brand" / "source" / "status-shields.jpg"
SOURCE_BANNER = REPO_ROOT / "brand" / "source" / "koi-banner-light.jpg"
OUT_DIR = REPO_ROOT / "packages" / "web" / "public" / "brand"

# Background pixels in both sources are near-perfectly desaturated (the checkerboard is pure
# grey/white, R==G==B) and light -- neither the koi's navy/teal/mint palette nor any shield's
# navy/mint/red/amber palette is ever both. Shared across derive_koi() and derive_shields().
CHROMA_THRESHOLD = 20.0  # max(R,G,B) - min(R,G,B); real subject colour is always well above this
LIGHTNESS_THRESHOLD = 140.0  # (max+min)/2; checkerboard tones measured at ~200 and ~255
FEATHER_PX = 2
CROP_PADDING_FRAC = 0.03  # a little breathing room around the subject's own bounding box
# brand/README.md's measured palette -- deep navy/midnight -- used only as the solid backing
# for apple-touch-icon.png below, never as a fill on the transparent exports.
TOUCH_ICON_BACKGROUND = (10, 32, 56)

TARGETS = [
    ("koi-512.png", 512, None),
    ("koi-192.png", 192, None),
    ("koi-64.png", 64, None),
    ("koi-32.png", 32, None),
    ("apple-touch-icon.png", 180, TOUCH_ICON_BACKGROUND),
]

# Left to right in status-shields.jpg, per kenzen#90's own issue text: mint check = healthy,
# crimson bug = vulnerable, amber exclamation = attention.
SHIELD_VARIANTS = ["healthy", "vulnerable", "attention"]
SHIELD_SIZES = (64, 32)

# derive_banner()'s light-checker key against koi-banner-light.jpg -- tuned by eye against
# this exact source, do not change without re-checking with roshne. See the module doc
# comment's step list above for what each one does.
BG_LUM_MIN = 228.0  # neutral pixels at least this bright are background candidates
BG_CHROMA_MAX = 10.0  # max-min channel spread for "neutral"
DARK_LUM = 120.0  # outline pixels; regions they fence in are art regardless of colour
C2A_TRANSPARENT = 0.06  # colour-to-alpha transparency threshold (JPEG noise floor on the checker)
C2A_OPAQUE = 0.35  # opacity threshold: at/above this the pixel keeps its colour at alpha 1
FG_FLOOR = 0.6  # un-matted colour may not drop below this fraction of the observed pixel
CROP_MARGIN = 16


def remove_checkerboard(img: Image.Image) -> Image.Image:
    """Real-alpha RGBA version of `img`, with the baked checkerboard background removed and
    the cutout edge feathered."""
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    chroma = channel_max - channel_min
    lightness = (channel_max + channel_min) / 2
    is_background = (chroma < CHROMA_THRESHOLD) & (lightness > LIGHTNESS_THRESHOLD)
    alpha = np.where(is_background, 0, 255).astype(np.uint8)
    alpha_img = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(FEATHER_PX))
    rgba = img.convert("RGBA")
    rgba.putalpha(alpha_img)
    return rgba


def crop_to_content(rgba: Image.Image, padding_frac: float) -> Image.Image:
    """Tight bounding box of the non-transparent pixels, with `padding_frac` of the larger
    dimension added on every side so the cutout isn't touching the canvas edge."""
    alpha = np.asarray(rgba.split()[-1])
    rows = np.any(alpha > 8, axis=1)
    cols = np.any(alpha > 8, axis=0)
    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    pad = int(max(right - left, bottom - top) * padding_frac)
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(rgba.width, right + pad + 1)
    bottom = min(rgba.height, bottom + pad + 1)
    return rgba.crop((left, top, right, bottom))


def fit_into_square(
    img: Image.Image, size: int, background: tuple[int, int, int] | None = None
) -> Image.Image:
    """`img` resized (preserving aspect ratio) to fit within `size`x`size`, centered on a
    square canvas of exactly that size. `background=None` (the default) keeps the canvas
    transparent; a solid `(r, g, b)` flattens the result instead, for the one target (the
    apple touch icon) that must not carry alpha."""
    scale = size / max(img.width, img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas_color = (*background, 255) if background is not None else (0, 0, 0, 0)
    canvas = Image.new("RGBA", (size, size), canvas_color)
    canvas.paste(resized, ((size - new_w) // 2, (size - new_h) // 2), resized)
    return canvas.convert("RGB") if background is not None else canvas


def derive_koi() -> None:
    source = Image.open(SOURCE_KOI)
    cutout = crop_to_content(remove_checkerboard(source), CROP_PADDING_FRAC)
    for filename, size, background in TARGETS:
        fit_into_square(cutout, size, background).save(OUT_DIR / filename)
        print(f"wrote {OUT_DIR / filename} ({size}x{size})")


def derive_shields() -> None:
    """Slices `status-shields.jpg` into three equal-width thirds -- one per variant, left to
    right -- before running each through the same checkerboard removal and bounding-box crop
    `derive_koi()` uses, so one shield's crop can never pick up a sliver of its neighbour."""
    source = Image.open(SOURCE_SHIELDS).convert("RGB")
    width, _height = source.size
    edges = [round(i * width / len(SHIELD_VARIANTS)) for i in range(len(SHIELD_VARIANTS) + 1)]
    for variant, left, right in zip(SHIELD_VARIANTS, edges, edges[1:]):
        third = source.crop((left, 0, right, source.height))
        cutout = crop_to_content(remove_checkerboard(third), CROP_PADDING_FRAC)
        for size in SHIELD_SIZES:
            filename = f"shield-{variant}-{size}.png"
            fit_into_square(cutout, size).save(OUT_DIR / filename)
            print(f"wrote {OUT_DIR / filename} ({size}x{size})")


def _maxfilter(mask, size):
    return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(size))) > 0


def _flood_from_border(passable):
    """Pixels reachable from the image border moving only through `passable` pixels."""
    H, W = passable.shape
    im = Image.fromarray(np.where(passable, 0, 255).astype(np.uint8)).copy()  # .copy(): floodfill no-ops on an array-backed image
    seeds = (
        [(x, 0) for x in range(W)]
        + [(x, H - 1) for x in range(W)]
        + [(0, y) for y in range(H)]
        + [(W - 1, y) for y in range(H)]
    )
    for p in seeds:
        if im.getpixel(p) == 0:
            ImageDraw.floodfill(im, p, 128)
    return np.asarray(im) == 128


def derive_banner() -> None:
    """Ported verbatim from the tuned light-checker reference recipe (kenzen#92 round 4,
    replacing the flat-navy recipe once that source proved unrecoverable at the edges) --
    see the module doc comment's step list above. Exports both a PNG and a lossless WebP."""
    src = Image.open(SOURCE_BANNER).convert("RGB")
    rgb = np.asarray(src).astype(np.float32)
    H, W, _ = rgb.shape
    lum = rgb.mean(2)
    chroma = rgb.max(2) - rgb.min(2)

    # 1-2. background = neutral light grey not fenced in by a dark outline
    bglike = (lum >= BG_LUM_MIN) & (chroma <= BG_CHROMA_MAX)
    dark = _maxfilter(lum < DARK_LUM, 3)
    reached = _flood_from_border(~dark)
    inside_outline = ~reached & ~_maxfilter(reached, 3)
    bg = ~(~bglike | inside_outline)

    # 3. local background estimate: what the checker would be under the art
    est = np.where(bg[..., None], rgb, 0.0)
    cnt = bg.astype(np.float32)
    for _ in range(6):
        b = np.asarray(
            Image.fromarray(np.clip(est, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
        ).astype(np.float32)
        c = np.asarray(
            Image.fromarray((cnt * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
        ).astype(np.float32) / 255
        filled = b / np.maximum(c[..., None], 1e-3)
        est = np.where(bg[..., None], rgb, filled)
        cnt = np.where(bg, 1.0, np.minimum(c, 1.0))
    k = np.clip(est, 0, 255) / 255

    # colour-to-alpha with transparency + opacity thresholds (GIMP semantics)
    c = rgb / 255
    up = (c - k) / np.maximum(1 - k, 1e-6)
    dn = (k - c) / np.maximum(k, 1e-6)
    ag = np.where(c > k, up, np.where(c < k, dn, 0)).max(2)
    alpha = np.clip((ag - C2A_TRANSPARENT) / (C2A_OPAQUE - C2A_TRANSPARENT), 0, 1)
    alpha[inside_outline] = 1.0
    alpha[alpha < 0.02] = 0.0
    a3 = alpha[..., None]
    fg = np.where(a3 > 0, (c - k * (1 - a3)) / np.maximum(a3, 1e-6), c)
    fg = np.maximum(fg, c * FG_FLOOR)  # 4. cap the darkening of low-alpha pixels
    out_rgb = np.clip(np.where(a3 >= 1.0, c, fg), 0, 1)
    out = Image.fromarray((np.dstack([out_rgb, a3]) * 255).astype(np.uint8), "RGBA")

    # 5. crop to content + margin
    ys, xs = np.nonzero(alpha > 0.02)
    y0, y1 = max(ys.min() - CROP_MARGIN, 0), min(ys.max() + CROP_MARGIN + 1, H)
    x0, x1 = max(xs.min() - CROP_MARGIN, 0), min(xs.max() + CROP_MARGIN + 1, W)
    out = out.crop((int(x0), int(y0), int(x1), int(y1)))

    png_path = OUT_DIR / "koi-banner.png"
    out.save(png_path)
    print(f"wrote {png_path} ({out.width}x{out.height})")
    webp_path = OUT_DIR / "koi-banner.webp"
    out.save(webp_path, lossless=True)
    print(f"wrote {webp_path} ({out.width}x{out.height})")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    derive_koi()
    derive_shields()
    derive_banner()


if __name__ == "__main__":
    main()
