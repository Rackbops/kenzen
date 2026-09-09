#!/usr/bin/env python3
"""kenzen#89/#90: derives real-alpha PNG cutouts from two flattened-onto-checkerboard JPEG
sources -- roshne's direction for the whole brand epic was to use the artwork as-is, in its
real colours, not a hand-redrawn approximation. Both sources bake a grey/white checkerboard
in place of transparency (JPG has no alpha channel); this script rebuilds a real alpha
channel by treating the checkerboard's own signature -- pixels that are both nearly
perfectly desaturated (R almost equal to G almost equal to B) AND light -- as background,
feathers the edge 2px so the cutout doesn't have a hard-pixelated silhouette, crops to the
subject's own bounding box, and resizes into each target size.

- `brand/source/koi-teal.jpg` (kenzen#89): the Code Stream Koi mark, one subject filling the
  frame -- `derive_koi()`.
- `brand/source/status-shields.jpg` (kenzen#90): three status shields (healthy/vulnerable/
  attention, left to right) side by side in one frame -- `derive_shields()` slices the frame
  into equal thirds first (each shield's own bounding-box crop then runs inside just its
  third, so one shield's content can never bleed into a neighbour's crop) and otherwise
  reuses the exact same checkerboard-removal technique. Each shield's inner ring (between the
  outer silhouette and the inner body) is genuine transparency in the source art, not a solid
  stroke -- confirmed by zooming into the source JPEG, where the same checkerboard pattern
  and phase as the true background shows through it -- so the plain per-pixel threshold
  already removes it correctly, letting it show whatever sits behind the rendered `<img>`
  (the theme's own background) rather than a hardcoded colour.

Run with (Windows, this machine -- see the repo CLAUDE.md on Python invocation):
    py -3.12 brand/derive.py

Requires Pillow and numpy (not repo dependencies -- a one-off asset-derivation script, run
by hand when the source art changes, not part of any build).

Writes packages/web/public/brand/koi-{512,192,64,32}.png, apple-touch-icon.png (180), and
shield-{healthy,vulnerable,attention}-{64,32}.png -- each the source's own aspect ratio
centered in a transparent square canvas.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_KOI = REPO_ROOT / "brand" / "source" / "koi-teal.jpg"
SOURCE_SHIELDS = REPO_ROOT / "brand" / "source" / "status-shields.jpg"
OUT_DIR = REPO_ROOT / "packages" / "web" / "public" / "brand"

# Background pixels in both sources are near-perfectly desaturated (the checkerboard is pure
# grey/white, R==G==B) and light -- neither the koi's navy/teal/mint palette nor any shield's
# navy/mint/red/amber palette is ever both. Shared across derive_koi() and derive_shields().
CHROMA_THRESHOLD = 20.0  # max(R,G,B) - min(R,G,B); real subject colour is always well above this
LIGHTNESS_THRESHOLD = 140.0  # (max+min)/2; checkerboard tones measured at ~200 and ~255
FEATHER_PX = 2
CROP_PADDING_FRAC = 0.03  # a little breathing room around the subject's own bounding box

KOI_TARGETS = [
    ("koi-512.png", 512),
    ("koi-192.png", 192),
    ("koi-64.png", 64),
    ("koi-32.png", 32),
    ("apple-touch-icon.png", 180),
]

# Left to right in status-shields.jpg, per kenzen#90's own issue text: mint check = healthy,
# crimson bug = vulnerable, amber exclamation = attention.
SHIELD_VARIANTS = ["healthy", "vulnerable", "attention"]
SHIELD_SIZES = (64, 32)


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


def fit_into_square(img: Image.Image, size: int) -> Image.Image:
    """`img` resized (preserving aspect ratio) to fit within `size`x`size`, centered on a
    transparent canvas of exactly that size."""
    scale = size / max(img.width, img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - new_w) // 2, (size - new_h) // 2), resized)
    return canvas


def derive_koi() -> None:
    source = Image.open(SOURCE_KOI)
    cutout = crop_to_content(remove_checkerboard(source), CROP_PADDING_FRAC)
    for filename, size in KOI_TARGETS:
        fit_into_square(cutout, size).save(OUT_DIR / filename)
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


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    derive_koi()
    derive_shields()


if __name__ == "__main__":
    main()
