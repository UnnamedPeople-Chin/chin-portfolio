#!/usr/bin/env node
/* tools/gen-deckle-mask.mjs — the committed generator for --deckle.
 *
 * The deckled edge of the plate sheet is an alpha mask: an SVG path that IS
 * the paper's own outline (top and sides straight, bottom edge walking the
 * deckle). It is GENERATED, never hand-edited — one line of the stylesheet is
 * its only home, and this script is the only thing that writes it.
 *
 * Deterministic by construction: the jitter is a fixed literal sequence, so
 * every run is byte-identical and `git diff` stays quiet. No Math.random().
 *
 *   node tools/gen-deckle-mask.mjs            print the line, rewrite the page
 *   node tools/gen-deckle-mask.mjs --check    exit 1 if the page is out of date
 *   node tools/gen-deckle-mask.mjs --print    print only, never touch the page
 *
 * Spec: entrance-v2-spec/03-css.md §6 (INSERTION 0, and the generator note).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "..", "public", "landing-pages", "chin-portfolio.html");

const W = 1000; // viewBox width
const H = 2000; // viewBox height
const D_MIN = 2; // shallowest notch, in viewBox units
const D_SPAN = 10; // depth span: deepest notch is D_MIN + D_SPAN = 12 units
/* The band arithmetic, dimensionally: the mask maps 1:1 onto the sheet, so a
   depth of D units is D/2000 of the sheet's height. At the largest sheet
   (min(84vw,940px,128vh) = 940px wide → 528.75px tall) 12 units = 3.17px —
   far inside the 17px gold band, which is why the lip is never cut off.
   The constraint to keep: (12/2000) * sheet_height < 17px. */

/* 34 fixed literals in [0,1], spanning the full range so the walk uses the
   whole 0–12-unit depth budget (10 * n over n ∈ [0,1]). Hand-authored,
   deliberately irregular — a jittered walk, not a wave. */
const N = [
  0.0, 0.62, 0.18, 0.85, 0.34, 1.0, 0.22, 0.55, 0.9, 0.4, 0.12, 0.7, 0.48,
  0.97, 0.6, 0.26, 0.78, 0.44, 0.15, 0.66, 0.93, 0.52, 0.3, 0.72, 0.38, 0.88,
  0.58, 0.2, 0.8, 0.46, 0.96, 0.54, 0.32, 0.76,
];

const r2 = (n) => String(Math.round(n * 100) / 100);

/* The path: M0 0 H1000 (top) V{y0} (right edge down to the first notch),
   then a leftward walk along the deckle, H0, Z (left edge closes to 0 0). */
function buildPath() {
  const verts = N.map((n, i) => ({
    x: W - (W / (N.length - 1)) * i,
    y: H - (D_MIN + D_SPAN * n),
  }));
  let d = "M0 0 H" + W + " V" + r2(verts[0].y);
  for (let i = 1; i < verts.length; i++) d += " L" + r2(verts[i].x) + " " + r2(verts[i].y);
  return d + " H0 Z";
}

/* Percent-encoded so what lands in the stylesheet is already URL-safe:
   `<` → %3C, `#` → %23, and double quotes become single quotes. */
function buildUri() {
  return (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'" +
    " width='1000' height='2000' preserveAspectRatio='none'%3E" +
    "%3Cpath fill='%23fff' d='" + buildPath() + "'/%3E%3C/svg%3E"
  );
}

function buildLine() {
  return '        --deckle:url("' + buildUri() + '");';
}

const MARK_A = '--deckle:url("';
const MARK_B = '");';

const args = process.argv.slice(2);
const line = buildLine();
const uri = buildUri();
const src = readFileSync(PAGE, "utf8");
const at = src.indexOf(MARK_A);

if (at === -1) {
  console.log(line);
  console.log("\n(no --deckle marker in " + PAGE + " — printed only, nothing rewritten)");
  process.exit(args.includes("--check") ? 1 : 0);
}

const end = src.indexOf(MARK_B, at + MARK_A.length);
if (end === -1) {
  console.error("FATAL: found --deckle:url(\" at " + at + " but no closing \");");
  process.exit(1);
}
const current = src.slice(at + MARK_A.length, end);

if (args.includes("--print")) {
  console.log(line);
  process.exit(0);
}

if (current === uri) {
  console.log("up to date — " + uri.length + " bytes, " + N.length + " vertices");
  process.exit(0);
}

if (args.includes("--check")) {
  console.error("STALE: --deckle in " + PAGE + " differs from the generator output");
  process.exit(1);
}

writeFileSync(PAGE, src.slice(0, at + MARK_A.length) + uri + src.slice(end));
console.log("rewrote --deckle (" + current.length + " → " + uri.length + " bytes)");
console.log(line);
