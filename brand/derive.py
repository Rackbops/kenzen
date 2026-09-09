#!/usr/bin/env python3
"""kenzen#89: derives real-alpha PNG cutouts of the Code Stream Koi from
brand/source/koi-teal.jpg -- roshne's direction was to use the artwork as-is, in its real
colours, not a hand-redrawn approximation. koi-teal.jpg bakes a grey/white checkerboard in
place of transparency (JPG has no alpha channel); this script rebuilds a real alpha channel
by treating the checkerboard's own signature -- pixels that are both nearly perfectly
desaturated (R almost equal to G almost equal to B) AND light -- as background, feathers the
edge 2px so the cutout doesn't have a hard-pixelated silhouette, crops to the fish's own
bounding box, and resizes into each target icon size.

Run with (Windows, this machine -- see the repo CLAUDE.md on Python invocation):
    py -3.12 brand/derive.py

Requires Pillow and numpy (not repo dependencies -- a one-off asset-derivation script, run
by hand when the source art changes, not part of any build).

Writes packages/web/public/brand/koi-{512,192,64,32}.png (transparent, the fish's own aspect
ratio centered in the square canvas) and apple-touch-icon.png (180, same crop, but flattened
onto a solid navy background -- iOS doesn't compositing-blend a transparent touch icon, it can
render the empty area black instead, per Apple's own HIG).
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "brand" / "source" / "koi-teal.jpg"
OUT_DIR = REPO_ROOT / "packages" / "web" / "public" / "brand"

# Background pixels in this source are near-perfectly desaturated (the checkerboard is pure
# grey/white, R==G==B) and light -- the fish's navy/teal/mint palette is never both.
CHROMA_THRESHOLD = 20.0  # max(R,G,B) - min(R,G,B); real fish colour is always well above this
LIGHTNESS_THRESHOLD = 140.0  # (max+min)/2; checkerboard tones measured at ~200 and ~255
FEATHER_PX = 2
CROP_PADDING_FRAC = 0.03  # a little breathing room around the fish's own bounding box
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


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    cutout = crop_to_content(remove_checkerboard(source), CROP_PADDING_FRAC)
    for filename, size, background in TARGETS:
        fit_into_square(cutout, size, background).save(OUT_DIR / filename)
        print(f"wrote {OUT_DIR / filename} ({size}x{size})")


if __name__ == "__main__":
    main()
