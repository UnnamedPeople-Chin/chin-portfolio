#!/usr/bin/env python3
"""Generate an inline-SVG "signature" wordmark from a font's glyph outlines.

This is the build-time half of the intro's drawn name. It extracts the OUTLINE
of every character of TEXT at a fixed em size, lays the glyphs out on one
baseline using the font's own advance widths, and emits:

  * JSON  — { width, height, viewBox, glyphs: [{ d, delayMs }, ...] }
  * SVG   — a ready block using the Signature technique's two layers:
              a <mask> whose paths are STROKED and revealed by an animated
              dashoffset (the "brush"), and the FILLED glyphs painted through
              that mask (the "ink").

Only the derived outlines are ever shipped. The font file itself is not
redistributed at runtime: the .woff2 stays in the repo as a build input and
the page carries nothing but SVG path data.

Usage:
  python tools/gen-signature.py --font public/chin-portfolio/foo.ttf \
      --text "Jizdan YR" [--size 100] [--tracking 0] [--pad 0.06]
      [--json out.json] [--svg out.svg]
"""

from __future__ import annotations

import argparse
import json
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform


def _ntos(v: float) -> str:
    """Format a coordinate with 2 decimals, dropping trailing zeros.

    fontTools' default prints 15 significant digits, which inflates the path
    data ~5x for no visible gain: at the sizes this wordmark renders, 2
    decimals is sub-pixel.
    """
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def load_font(path: str) -> TTFont:
    font = TTFont(path)
    # A CID-keyed CFF (e.g. some Google Fonts) reports its cmap on a subfont;
    # getBestCmap() walks to the right table in every case we care about.
    if "cmap" not in font:
        raise SystemExit(f"{path}: no cmap table — cannot map characters")
    return font


def glyph_path(font: TTFont, gs, char: str, scale: float, x: float, baseline: float):
    """Return (svg path data, advance width in SVG units) for one character."""
    cmap = font.getBestCmap()
    if ord(char) not in cmap:
        raise SystemExit(f"font has no glyph for {char!r} (U+{ord(char):04X})")
    name = cmap[ord(char)]
    glyph = gs[name]

    pen = SVGPathPen(gs, ntos=_ntos)
    # Font units are Y-up; SVG is Y-down. Flip Y and drop the baseline in.
    tpen = TransformPen(pen, Transform(scale, 0, 0, -scale, x, baseline))
    glyph.draw(tpen)

    return pen.getCommands(), glyph.width * scale


def bounds_of(font: TTFont, gs, char: str, scale: float, x: float, baseline: float):
    cmap = font.getBestCmap()
    glyph = gs[cmap[ord(char)]]
    pen = BoundsPen(gs)
    tpen = TransformPen(pen, Transform(scale, 0, 0, -scale, x, baseline))
    glyph.draw(tpen)
    return pen.bounds  # (xMin, yMin, xMax, yMax) or None for blank glyphs


def build(font_path: str, text: str, size: float, tracking: float, pad_ratio: float):
    font = load_font(font_path)
    gs = font.getGlyphSet()
    upm = font["head"].unitsPerEm
    scale = size / upm

    # ---- pass 1: lay the glyphs out and measure the whole run --------------
    x = 0.0
    laid: list[tuple[str, float, float]] = []  # (char, x, advance)
    boxes = []
    for i, ch in enumerate(text):
        adv_units = gs[font.getBestCmap()[ord(ch)]].width
        adv = adv_units * scale + (tracking * size if i else 0.0)
        laid.append((ch, x, adv))
        if not ch.isspace():
            b = bounds_of(font, gs, ch, scale, x, 0.0)
            if b:
                boxes.append(b)
        x += adv
    run_width = x

    if not boxes:
        raise SystemExit("nothing drawn — is TEXT empty or all whitespace?")

    x_min = min(b[0] for b in boxes)
    y_min = min(b[1] for b in boxes)
    x_max = max(b[2] for b in boxes)
    y_max = max(b[3] for b in boxes)

    # The brush mask is a STROKE, so it bleeds half a stroke-width past the
    # outline on every side. The viewBox must carry at least that much padding
    # or the brush is clipped flat at the edge (the classic "cut R" bug).
    stroke_units = 0.20 * size  # kept in sync with --stroke below
    pad = max(pad_ratio * size, stroke_units)
    vx = x_min - pad
    vy = y_min - pad
    vw = (x_max - x_min) + 2 * pad
    vh = (y_max - y_min) + 2 * pad

    # ---- pass 2: rebuild every outline translated into the padded viewBox --
    glyphs = []
    for i, (ch, gx, adv) in enumerate(laid):
        if ch.isspace():
            continue
        # Re-emit through a translate-only pen so the numbers are already in
        # viewBox space and the SVG needs no wrapper transform.
        pen = SVGPathPen(gs, ntos=_ntos)
        cmap = font.getBestCmap()
        glyph = gs[cmap[ord(ch)]]
        tpen = TransformPen(
            pen, Transform(scale, 0, 0, -scale, gx - vx, -vy)
        )
        glyph.draw(tpen)
        d = pen.getCommands()
        if not d:
            continue
        glyphs.append({"char": ch, "index": i, "d": d, "advance": adv})

    return {
        "width": vw,
        "height": vh,
        "viewBox": f"0 0 {vw:.3f} {vh:.3f}",
        "runWidth": run_width,
        "unitsPerEm": upm,
        "font": font["name"].getDebugName(1),
        "glyphs": glyphs,
    }


def emit_svg(data: dict, stroke_ratio: float, stagger_ms: int, duration_ms: int) -> str:
    vb = data["viewBox"]
    w = data["width"]
    h = data["height"]
    # Brush thickness, expressed as a fraction of the viewBox height, so the
    # brush reads the same weight whatever the font's em/proportions.
    stroke = stroke_ratio * h

    mask_paths = []
    fill_paths = []
    for g in data["glyphs"]:
        delay = g["index"] * stagger_ms
        mask_paths.append(
            f'          <path d="{g["d"]}" pathLength="1" '
            f'style="--d:{delay}ms"/>'
        )
        fill_paths.append(f'          <path d="{g["d"]}"/>')

    return f"""<svg class="intro-signature" viewBox="{vb}" role="img"
     aria-label="{data.get('label', '')}" focusable="false">
        <defs>
          <mask id="introSigMask" maskUnits="userSpaceOnUse"
                x="{-stroke}" y="{-stroke}"
                width="{w + 2 * stroke:.3f}" height="{h + 2 * stroke:.3f}">
            <g class="intro-sig-brush" fill="none" stroke="#fff"
               stroke-width="{stroke:.3f}" stroke-linecap="round"
               stroke-linejoin="round">
{chr(10).join(mask_paths)}
            </g>
          </mask>
        </defs>
        <g class="intro-sig-ink" mask="url(#introSigMask)" fill="currentColor">
{chr(10).join(fill_paths)}
        </g>
      </svg>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--font", required=True)
    ap.add_argument("--text", default="Jizdan YR")
    ap.add_argument("--size", type=float, default=100.0, help="em size, SVG units")
    ap.add_argument("--tracking", type=float, default=0.0, help="extra tracking, em")
    ap.add_argument("--pad", type=float, default=0.06, help="padding, em")
    ap.add_argument("--stroke", type=float, default=0.20, help="brush width / run height")
    ap.add_argument("--stagger", type=int, default=70, help="per-glyph stagger, ms")
    ap.add_argument("--duration", type=int, default=620, help="per-glyph draw, ms")
    ap.add_argument("--json")
    ap.add_argument("--svg")
    args = ap.parse_args()

    data = build(args.font, args.text, args.size, args.tracking, args.pad)
    data["label"] = args.text
    svg = emit_svg(data, args.stroke, args.stagger, args.duration)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    if args.svg:
        with open(args.svg, "w", encoding="utf-8") as fh:
            fh.write(svg)

    print(
        f"{data['font']}: {len(data['glyphs'])} glyphs, "
        f"viewBox={data['viewBox']}, runWidth={data['runWidth']:.2f}"
    )
    if not args.svg and not args.json:
        print(svg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
