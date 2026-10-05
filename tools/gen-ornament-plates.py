#!/usr/bin/env python3
"""Turn a supplied photograph / painting into an engraved ornament plate.

The portfolio's decorative plates (public/chin-portfolio/engraved/*.webp) are
all cream/gold line art on transparency, screened onto the navy ground by
`.orn { mix-blend-mode:screen }`. This script reproduces that treatment from a
colour source so a new reference image can join the set:

  * luminance -> ink map (dark areas become ink, light areas stay transparent)
  * a gradient pass on top, so edges keep the drawn line quality
  * cream->gold colouring keyed off ink strength (weak = cream, deep = gold)
  * an alpha feather that ramps to 0 at every image border, so the plate can
    never paint a hard rectangular "box" onto the ground

Two modes:

  convert  <src> <dst> [--width N] [--feather F] [--ink K] [--gamma G]
           produce a new plate from a source image

  feather  <path> [--feather F]
           soften the borders of an EXISTING plate in place (used to repair
           plates whose alpha reaches 255 at the image edge)

Usage:
  python tools/gen-ornament-plates.py convert shots/user/user-attach-2.png \
      public/chin-portfolio/engraved/stone-alley.webp --width 760
  python tools/gen-ornament-plates.py feather \
      public/chin-portfolio/engraved/baroque.webp --feather 0.07
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# The palette the existing plates are built from (see the --ink / --earth
# tokens in chin-portfolio.html).
CREAM = np.array([239.0, 231.0, 214.0])
GOLD = np.array([198.0, 160.0, 83.0])


def _smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def feather_mask(w: int, h: int, frac: float) -> np.ndarray:
    """1.0 across the interior, easing to 0.0 at every border.

    `frac` is the ramp depth as a fraction of the shorter side. This is the
    whole reason a converted plate can never show a hard edge: alpha is
    multiplied by a value that is provably 0 on the outermost pixel row/column.
    """
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.minimum.reduce(
        [xx, (w - 1) - xx, yy, (h - 1) - yy]
    ).astype(np.float32)
    ramp = max(1.0, min(w, h) * frac)
    return _smoothstep(dist / ramp)


def ink_map(rgb: np.ndarray, edge_div: float) -> np.ndarray:
    """Darkness + edge energy, normalised to 0..1.

    The weights below are tuned against the plates already in the repo: they
    land a converted photograph in the same band as the hand-drawn set
    (roughly 35-55% of the plate inked, median alpha ~90-130), so it reads as
    etching rather than as a photograph dropped into a gold rectangle.
    """
    lum = (
        0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    ).astype(np.float32)

    # Slight blur before the edge pass so film grain does not read as linework.
    blurred = Image.fromarray(lum.astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(1.1)
    )
    smooth = np.asarray(blurred, dtype=np.float32)

    # Darkness: the flat tone that becomes broad ink washes (shadows, stone).
    tone = 1.0 - smooth / 255.0

    # Edge energy: what keeps windows, foliage and stone joints legible.
    edges = np.asarray(
        blurred.filter(ImageFilter.FIND_EDGES), dtype=np.float32
    )
    edges = np.clip(edges / edge_div, 0.0, 1.0)

    return np.clip(0.50 * tone + 0.80 * edges, 0.0, 1.0)


def colorize(ink: np.ndarray) -> np.ndarray:
    """Deep ink -> gold, faint ink -> cream, so the plate has a two-tone draw."""
    t = _smoothstep((ink - 0.12) / 0.78)[..., None]
    return CREAM * (1.0 - t) + GOLD * t


def convert(
    src: Path,
    dst: Path,
    width: int = 760,
    feather: float = 0.07,
    ink_gain: float = 1.0,
    gamma: float = 1.0,
    floor: float = 0.30,
    edge_div: float = 38.0,
    quality: int = 82,
) -> None:
    img = Image.open(src).convert("RGB")
    if img.width != width:
        height = max(1, round(img.height * width / img.width))
        img = img.resize((width, height), Image.LANCZOS)
    rgb = np.asarray(img, dtype=np.float32)
    h, w = rgb.shape[:2]

    ink = ink_map(rgb, edge_div)
    # Lift the midtones, then push the very faint end to true transparency so
    # the plate reads as line art instead of a grey rectangle.
    ink = np.clip(ink * ink_gain, 0.0, 1.0) ** gamma
    alpha = _smoothstep((ink - floor) / (1.0 - floor)) * 255.0
    alpha *= feather_mask(w, h, feather)

    colour = colorize(ink)
    out = np.dstack([colour, alpha]).astype(np.uint8)
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(
        dst, "WEBP", quality=quality, method=6, alpha_quality=92
    )
    print(f"convert  {src.name:32s} -> {dst.name:26s} {w}x{h}  "
          f"ink={ink.mean():.3f}  border_alpha={_border_alpha(alpha):.0f}")


def repair(path: Path, feather: float = 0.07) -> None:
    """Multiply an existing plate's alpha by a border feather, in place."""
    img = Image.open(path).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)
    h, w = arr.shape[:2]
    before = _border_alpha(arr[:, :, 3])
    arr[:, :, 3] *= feather_mask(w, h, feather)
    after = _border_alpha(arr[:, :, 3])
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(
        path, "WEBP", quality=88, method=6, alpha_quality=100
    )
    print(f"feather  {path.name:26s} {w}x{h}  "
          f"border_alpha {before:.0f} -> {after:.0f}")


def _border_alpha(alpha: np.ndarray) -> float:
    """Peak alpha in the outermost 8px band — 0 means a clean fade."""
    b = 8
    return float(
        max(
            alpha[:b, :].max(),
            alpha[-b:, :].max(),
            alpha[:, :b].max(),
            alpha[:, -b:].max(),
        )
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    c = sub.add_parser("convert", help="source image -> engraved plate")
    c.add_argument("src", type=Path)
    c.add_argument("dst", type=Path)
    c.add_argument("--width", type=int, default=760)
    c.add_argument("--feather", type=float, default=0.07)
    c.add_argument("--ink", dest="ink_gain", type=float, default=1.0)
    c.add_argument("--gamma", type=float, default=1.0)
    c.add_argument("--floor", type=float, default=0.30)
    c.add_argument("--edge-div", dest="edge_div", type=float, default=38.0)
    c.add_argument("--quality", type=int, default=82)

    f = sub.add_parser("feather", help="soften an existing plate's borders")
    f.add_argument("path", type=Path)
    f.add_argument("--feather", type=float, default=0.07)

    args = parser.parse_args(argv)
    if args.mode == "convert":
        convert(
            args.src,
            args.dst,
            width=args.width,
            feather=args.feather,
            ink_gain=args.ink_gain,
            gamma=args.gamma,
            floor=args.floor,
            edge_div=args.edge_div,
            quality=args.quality,
        )
    else:
        repair(args.path, feather=args.feather)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
