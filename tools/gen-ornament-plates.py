#!/usr/bin/env python3
"""Turn a supplied colour illustration into an engraved ornament plate.

The portfolio's decorative plates (public/chin-portfolio/engraved/*.webp) are
cream/gold line art on transparency, screened onto the navy ground by
`.orn { mix-blend-mode:screen }`. A hand-drawn plate is sparse and pale; a
photograph or a busy colour illustration is neither, so a naive
"darkness -> alpha" conversion turns a midtone-heavy picture into a faint
beige rectangle — at the low opacities the page uses, a visible "photo box".

This script avoids that with four passes:

  * a LOCAL-CONTRAST threshold — subtract a heavily-blurred copy of the
    luminance, then keep what is darker than its surroundings. That drops the
    picture's global tone (the rectangle) and keeps the subject's own linework;
  * an optional global-darkness term, so solid dark masses (a silhouette, a
    dark building) survive even where they are large and flat;
  * a cream->gold tone match, desaturated and lifted so the deep ink lands on
    the same pale cream as the hand-drawn set (deep ~ (218,211,195), sat ~11%);
  * an alpha fade that ramps to 0 across the top and bottom (and every border),
    so a plate dissolves into the ground instead of ending in a hard edge.

Modes:

  convert  <src> <dst> [--width N] ...    colour illustration -> engraved plate
  colour   <src> <dst> [--width N] ...    keep the illustration's own colour,
                                          fading only its top/bottom and borders
  feather  <path> [--feather F]           soften the borders of an existing
                                          plate in place (repairs plates whose
                                          alpha reaches 255 at the image edge)

Usage:
  # the alley is line-art-like enough for the engraved treatment:
  python tools/gen-ornament-plates.py convert _arsip-gambar/originals-plates/alley.jpg \
      public/chin-portfolio/engraved/stone-alley-640.webp --width 640 \
      --lo 0.040 --hi 0.155 --mass-w 0.35 --mass-floor 0.68

  # the rider is a full-frame painting, not line art: it needs a harder local
  # threshold, the strongest mass term, and a sharpen pass so its own edges read
  # as drawn lines at the page's low opacity:
  python tools/gen-ornament-plates.py convert _arsip-gambar/originals-plates/rider.jpg \
      public/chin-portfolio/engraved/rider-engraved-720.webp --width 720 \
      --lo 0.020 --hi 0.100 --mass-w 1.0 --mass-floor 0.60 --sharpen 0.8
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# The palette the plates are built from (see the --ink / --earth tokens in
# chin-portfolio.html).
CREAM = np.array([239.0, 231.0, 214.0])
GOLD = np.array([198.0, 160.0, 83.0])


def _smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _vfade(h: int, w: int, top: float, bot: float) -> np.ndarray:
    """1.0 across the middle band, easing to 0.0 at the top and bottom rows.

    This is what stops a plate reading as a photograph: its rectangle is
    dissolved into the ground rather than ending on a hard horizontal line.
    """
    yy = np.arange(h, dtype=np.float32)[:, None] / max(1, h - 1)
    a = _smoothstep(yy / top) if top > 0 else np.ones_like(yy)
    b = _smoothstep((1.0 - yy) / bot) if bot > 0 else np.ones_like(yy)
    return np.minimum(a, b) * np.ones((1, w), np.float32)


def _border_fade(h: int, w: int, frac: float) -> np.ndarray:
    """1.0 across the interior, easing to 0.0 at every border.

    `frac` is the ramp depth as a fraction of the shorter side, so alpha is
    provably 0 on the outermost pixel row/column and a plate can never paint a
    hard rectangular edge onto the ground.
    """
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([xx, (w - 1) - xx, yy, (h - 1) - yy]).astype(np.float32)
    return _smoothstep(d / max(1.0, min(w, h) * frac))


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


def convert(
    src: Path,
    dst: Path,
    width: int = 760,
    sigma: float = 0.05,
    lo: float = 0.024,
    hi: float = 0.120,
    mass_w: float = 0.6,
    mass_floor: float = 0.64,
    gold: float = 0.25,
    desat: float = 0.55,
    lift: float = 0.50,
    fade: float = 0.22,
    border: float = 0.08,
    blur: float = 1.0,
    sharpen: float = 0.0,
    flat: int = 0,
    quality: int = 90,
) -> None:
    img = Image.open(src).convert("RGB")
    if img.width != width:
        img = img.resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS)
    # A painting (as opposed to line art) carries a lot of soft midtone texture,
    # which the local-contrast threshold turns into grey mush. Flattening that
    # texture first and sharpening what is left lets the subject's own edges
    # read as drawn lines.
    if flat:
        img = img.filter(ImageFilter.MedianFilter(flat))
    if sharpen:
        img = img.filter(
            ImageFilter.UnsharpMask(radius=2, percent=int(sharpen * 100), threshold=2)
        )
    rgb = np.asarray(img, dtype=np.float32)
    h, w = rgb.shape[:2]

    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    blurred = Image.fromarray(lum.astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(blur))
    L = np.asarray(blurred, dtype=np.float32)

    # Local contrast: how much darker this pixel is than its wide surroundings.
    radius = max(3.0, min(h, w) * sigma)
    local = np.asarray(blurred.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    ink = _smoothstep(((local - L) / 255.0 - lo) / (hi - lo))

    # Global darkness: keep solid dark masses even where they are large and flat.
    if mass_w > 0:
        dark = 1.0 - L / 255.0
        ink = np.clip(ink + mass_w * _smoothstep((dark - mass_floor) / (1.0 - mass_floor)), 0.0, 1.0)

    alpha = ink * 255.0
    alpha *= _vfade(h, w, fade, fade) * _border_fade(h, w, border)

    t = _smoothstep((ink - (1.0 - gold)) / gold)[..., None]
    colour = CREAM * (1.0 - t) + GOLD * t
    l = 0.2126 * colour[:, :, 0] + 0.7152 * colour[:, :, 1] + 0.0722 * colour[:, :, 2]
    colour = colour * (1.0 - desat) + l[..., None] * desat
    colour = colour + (255.0 - colour) * lift

    out = np.dstack([colour, alpha]).astype(np.uint8)
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst, "WEBP", quality=quality, method=6, alpha_quality=95)

    m = alpha > 192
    c = colour[m].mean(axis=0) if m.any() else colour.reshape(-1, 3).mean(axis=0)
    mx, mn = c.max(), c.min()
    print(f"convert  {src.name:24s} -> {dst.name:24s} {w}x{h}  "
          f"cov>40={(alpha > 40).mean() * 100:3.0f}%  "
          f"deep=({c[0]:.0f},{c[1]:.0f},{c[2]:.0f}) sat={(mx - mn) / mx * 100:4.1f}% "
          f"lum={0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]:.0f}  "
          f"border_a={_border_alpha(alpha):.0f}")


def colourise(
    src: Path,
    dst: Path,
    width: int = 1000,
    fade: float = 0.20,
    border: float = 0.07,
    saturation: float = 1.0,
    quality: int = 90,
) -> None:
    """Keep the illustration's own colour; only dissolve its rectangle.

    The supplied illustrations are vivid paintings (a blue hill town), not line
    art. Running one through `convert` throws away the very thing that makes it:
    the colour, so a solid mass like a horse flattens into a beige blob. This
    mode instead keeps the source RGB, masks it with the source's own alpha
    where it has one (or the full frame where it does not), and applies the same
    top/bottom and border fade the engraved plates use — so the picture stays
    itself and still melts into the navy ground instead of ending on a hard
    rectangular edge.

    `saturation` is a factor (1.0 = untouched) for dialling the colour back
    toward the page without going all the way to the engraved cream.
    """
    img = Image.open(src)
    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    img = img.convert("RGBA")
    if img.width != width:
        img = img.resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS)

    arr = np.asarray(img, dtype=np.float32)
    h, w = arr.shape[:2]
    rgb, src_a = arr[:, :, :3], arr[:, :, 3]

    if saturation != 1.0:
        l = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
        rgb = l[..., None] + (rgb - l[..., None]) * saturation

    if has_alpha:
        alpha = src_a * _vfade(h, w, fade, fade) * _border_fade(h, w, border)
    else:
        alpha = 255.0 * _vfade(h, w, fade, fade) * _border_fade(h, w, border)

    out = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst, "WEBP", quality=quality, method=6, alpha_quality=95)

    m = alpha > 192
    c = rgb[m].mean(axis=0) if m.any() else rgb.reshape(-1, 3).mean(axis=0)
    mx, mn = c.max(), c.min()
    print(f"colour   {src.name:24s} -> {dst.name:24s} {w}x{h}  "
          f"cov>40={(alpha > 40).mean() * 100:3.0f}%  "
          f"mean=({c[0]:.0f},{c[1]:.0f},{c[2]:.0f}) sat={(mx - mn) / max(mx, 1) * 100:4.1f}%  "
          f"border_a={_border_alpha(alpha):.0f}")


def repair(path: Path, feather: float = 0.07) -> None:
    """Multiply an existing plate's alpha by a border feather, in place."""
    img = Image.open(path).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)
    h, w = arr.shape[:2]
    before = _border_alpha(arr[:, :, 3])
    arr[:, :, 3] *= _border_fade(h, w, feather)
    after = _border_alpha(arr[:, :, 3])
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(
        path, "WEBP", quality=88, method=6, alpha_quality=100
    )
    print(f"feather  {path.name:26s} {w}x{h}  border_alpha {before:.0f} -> {after:.0f}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    c = sub.add_parser("convert", help="colour illustration -> engraved plate")
    c.add_argument("src", type=Path)
    c.add_argument("dst", type=Path)
    c.add_argument("--width", type=int, default=760)
    c.add_argument("--sigma", type=float, default=0.05,
                   help="local-contrast blur radius, as a fraction of the short side")
    c.add_argument("--lo", type=float, default=0.024, help="contrast threshold floor")
    c.add_argument("--hi", type=float, default=0.120, help="contrast threshold ceiling")
    c.add_argument("--mass-w", dest="mass_w", type=float, default=0.6,
                   help="weight of the global-darkness term (0 disables it)")
    c.add_argument("--mass-floor", dest="mass_floor", type=float, default=0.64)
    c.add_argument("--gold", type=float, default=0.25, help="fraction of the ink ramp that goes gold")
    c.add_argument("--desat", type=float, default=0.55)
    c.add_argument("--lift", type=float, default=0.50)
    c.add_argument("--fade", type=float, default=0.22,
                   help="top/bottom alpha fade depth, as a fraction of the height")
    c.add_argument("--border", type=float, default=0.08)
    c.add_argument("--blur", type=float, default=1.0)
    c.add_argument("--sharpen", type=float, default=0.0,
                   help="unsharp-mask amount 0..1 (a painting's soft midtones need it)")
    c.add_argument("--flat", type=int, default=0,
                   help="median-filter radius to flatten texture before thresholding")
    c.add_argument("--quality", type=int, default=90)

    k = sub.add_parser("colour", help="keep the illustration's colour, fade only its edges")
    k.add_argument("src", type=Path)
    k.add_argument("dst", type=Path)
    k.add_argument("--width", type=int, default=1000)
    k.add_argument("--fade", type=float, default=0.20,
                   help="top/bottom alpha fade depth, as a fraction of the height")
    k.add_argument("--border", type=float, default=0.07)
    k.add_argument("--saturation", type=float, default=1.0,
                   help="1.0 keeps the source colour; lower dials it toward grey")
    k.add_argument("--quality", type=int, default=90)

    f = sub.add_parser("feather", help="soften an existing plate's borders")
    f.add_argument("path", type=Path)
    f.add_argument("--feather", type=float, default=0.07)

    args = parser.parse_args(argv)
    if args.mode == "convert":
        convert(
            args.src, args.dst, width=args.width, sigma=args.sigma, lo=args.lo, hi=args.hi,
            mass_w=args.mass_w, mass_floor=args.mass_floor, gold=args.gold, desat=args.desat,
            lift=args.lift, fade=args.fade, border=args.border, blur=args.blur,
            sharpen=args.sharpen, flat=args.flat, quality=args.quality,
        )
    elif args.mode == "colour":
        colourise(
            args.src, args.dst, width=args.width, fade=args.fade, border=args.border,
            saturation=args.saturation, quality=args.quality,
        )
    else:
        repair(args.path, feather=args.feather)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
