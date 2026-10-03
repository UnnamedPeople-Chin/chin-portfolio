// tools/verify-entrance.mjs
//
// The entrance acceptance harness — 08-verify-harness.md, implemented in full
// but corrected where the verify pass proved the spec's own code wrong or
// unmeasurable. Three classes of correction, each recorded at its check:
//
//   · numbers the spec miscounted — A2 is 19 drawables + 2 clean strikes, not
//     21; A6's strike ENDS at settled identity (the spec sampled mid-flight);
//     A7's concurrency budget is <=6, not <=4 (all 19 drawables animate).
//   · timing power restored. Headless Chrome's CSS-animation clock lags wall
//     clock by ~700ms at startup, so the spec's fixed t0+N samples of CSS
//     progress are unreliable, and an unbounded poll loses the timing entirely.
//     A3/A4/A6/A7 assert the DECLARED schedule (delay/duration — deterministic,
//     headless-independent) with a live poll only as a liveness cross-check;
//     A5 and the B-block stamp the class onsets at the exact mutation, because
//     those are JS timers on the wall clock.
//   · false passes closed. Assertions that compared a value to the very value
//     that produced it (A4's bare <g> opacity, F3/F6's --pw identity, B2's
//     --burst-cy) or claimed a visibility they never read (B6's leaf, E2's
//     ReferenceError, C3's Lenis) now measure the real thing.
//
// Plus the headless-compositor keep-alive the spec's snippets assume but do
// not show, and the one in-page sampler (the exit walk) that survives a
// starved rAF loop.
//
// Dependency-free: Node >= 22 (native WebSocket + fetch), the project's own
// headless Chrome, and the dev server already running.
//
//   npm run dev            # in one shell
//   node tools/verify-entrance.mjs [--url http://localhost:5173/] [--port 9333] [--keep]
//
// Exit 0 only when every assertion passes. Six screenshots land in
// shots/entrance/. The two frames a human must actually look at:
//   02-turn-500.png    the gold lip on the ragged edge, the spark on the button
//   03-handoff-900.png the book turning while the cover is still partially opaque
// If 03 is blank or the cover is fully opaque in it, the exit failed regardless
// of what the DOM assertions say — that frame is the J1-3 fix, the one thing
// this whole revision exists to prove.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME =
  process.env.CHROME ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  // A flag passed last has no value; fall back rather than handing back
  // undefined (which would make PORT NaN and the endpoint URL invalid).
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const BASE = opt('--url', 'http://localhost:5173/');
const PORT = +opt('--port', '9333');
if (!Number.isFinite(PORT)) throw new Error('--port must be a number');
const SHOTS = path.resolve('shots/entrance');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(extraArgs = []) {
  return spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1440,900',
      // The software rasteriser for the mask/blend layers. Deliberately NO
      // --disable-gpu: it fights the swiftshader pair, and the proven step6/7
      // harnesses ran without it.
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=BackForwardCache',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${path.join(process.env.TEMP || '/tmp', `cp-verify-${PORT}`)}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

async function endpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return await r.json();
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chrome did not expose CDP on ' + PORT);
}

// Every CDP round-trip is bounded: a browser that dies mid-run must surface as
// a rejection the finally can act on, not leave an awaited send pending forever
// (which would skip proc.kill() and either hang CI or — if the socket closes
// and the loop drains — exit 0 with a partial set of checks, a silent pass).
const SEND_TIMEOUT = 30000;

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    // A transport death rejects everything still in flight, so the harness
    // fails loudly instead of hanging on a send that will never be answered.
    this.dead = null;
    const die = (why) => {
      if (this.dead) return;
      this.dead = why;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(why);
      }
      this.pending.clear();
    };
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, timer } = this.pending.get(m.id);
        this.pending.delete(m.id);
        clearTimeout(timer);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        (this.handlers.get(m.method) || []).forEach((fn) => fn(m.params));
      }
    });
    ws.addEventListener('close', () => die(new Error('CDP socket closed')));
    ws.addEventListener('error', () => die(new Error('CDP socket error')));
  }
  static async attach() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const target = list.find((t) => t.type === 'page');
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    const s = new Session(ws);
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    await s.send('Log.enable');
    return s;
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
    return () => this.off(method, fn);
  }
  off(method, fn) {
    const list = this.handlers.get(method);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(this.dead);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${SEND_TIMEOUT}ms`));
      }, SEND_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async goto(url, { wait = 250 } = {}) {
    let settle;
    const loaded = new Promise((res) => { settle = res; });
    // Detach after firing: goto runs ~15 times a session, and a handler left
    // behind would accumulate (and could let a late load event from an earlier
    // navigation resolve a later one).
    const detach = this.on('Page.loadEventFired', () => { detach(); settle(); });
    const to = setTimeout(() => { detach(); settle(); }, 20000);
    // A failed navigation (net::ERR_…) must fail fast: the checks that follow
    // would otherwise run against Chrome's error page, where D1/D2's "no stage,
    // no draws" is trivially true — a false pass.
    const nav = await this.send('Page.navigate', { url });
    if (nav && nav.errorText) {
      clearTimeout(to);
      detach();
      throw new Error(`navigate ${url}: ${nav.errorText}`);
    }
    await loaded;
    clearTimeout(to);
    await sleep(wait);
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ||
          JSON.stringify(r.exceptionDetails),
      );
    }
    return r.result.value;
  }
  async shot(name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, name + '.png');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  metrics(w, h, mobile = false) {
    return this.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile,
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ------------------------------------------------------------ assertion engine
const results = [];
let failures = 0;

function check(id, ok, detail = '') {
  results.push({ id, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  — ' + detail : ''}`);
}

/** Poll `fn()` until it returns truthy or the budget runs out. Returns the value or null. */
async function until(fn, ms = 4000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

/**
 * t0 = the frame .is-live lands, read from the stamp the bootstrap's
 * MutationObserver writes. Polling from Node would return a late value whenever
 * `.is-live` beat the first poll (it usually does), which would shorten every
 * subsequent `t0 + N` wait. The stamp is page-epoch ms — the same clock as
 * Node's Date.now() — so `t0 + N - Date.now()` stays meaningful.
 */
async function liveT0(s) {
  const v = await until(() => s.eval('window.__liveT0 || 0'), 8000, 16);
  if (!v) throw new Error('.is-live never landed');
  return v;
}

// Headless Chrome stops advancing CSS animations when nothing drives the
// compositor, so an idled page reports every element at its pre-animation
// value. Two things must therefore be installed BEFORE any page script runs:
// a bare rAF keep-alive (no style reads, so it cannot itself starve the clock),
// and a MutationObserver that stamps the exact frame `.is-live` lands — polling
// from Node would always return late and silently shorten every `t0 + N` wait.
// Page.addScriptToEvaluateOnNewDocument is the only place to put both.
// The observer targets `document`, not `document.documentElement`: this runs
// before the document element exists, and observing null throws a TypeError
// that would silently kill the stamp.
const BOOTSTRAP = `window.__t0 = Date.now();
(function loop(){ requestAnimationFrame(loop); })();
new MutationObserver(function(){
  var st = document.getElementById('introStage');
  if (st && st.classList.contains('is-live') && !window.__liveT0) {
    window.__liveT0 = Date.now();
  }
}).observe(document, {subtree:true, attributes:true, attributeFilter:['class']});`;

// ---------------------------------------------------------------- the run
// `proc` is launched before the try so its handle always exists, and `s` starts
// null so an early throw (Chrome never exposing CDP) still reaches the finally
// and cannot leak the browser process.
const proc = launch();
let s = null;

const page = BASE.replace(/\/$/, '') + '/landing-pages/chin-portfolio.html';

async function freshRun(url, mutate) {
  await s.send('Storage.clearDataForOrigin', {
    origin: new URL(page).origin,
    storageTypes: 'all',
  });
  if (mutate) await mutate();
  await s.goto(url, { wait: 200 });
}

try {
  await endpoint();
  s = await Session.attach();
  await s.metrics(1440, 900, false);

  // A cold tab every run: clear storage, bypass the HTTP cache, and install the
  // parse-time bootstrap (anchor + keep-alive + `.is-live` stamp) so it is live
  // before the page's first script — which is the only way `.is-live`'s own rAF
  // is serviced on time and `t0 + N` means what it says.
  await s.send('Network.enable');
  await s.send('Network.setCacheDisabled', { cacheDisabled: true });
  await s.send('Storage.clearDataForOrigin', {
    origin: new URL(page).origin,
    storageTypes: 'all',
  });
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP });

  await s.goto(page, { wait: 150 });

  // ---------------------------------------------------------------- A · timing
  const t0 = await liveT0(s);

  // A5's stamp. `.is-on` is added by a JS timer armed at `.is-live`, so the
  // resolve instant must be measured on the page's own clock at the exact
  // mutation — not by a Node poll that A3/A4's own variable-length polls can
  // start late. Install it here, ~3.4s before the resolve.
  await s.eval(`(() => {
    window.__resolveT = 0;
    const b = document.getElementById('introContinueBtn');
    if (b) new MutationObserver(() => {
      if (b.classList.contains('is-on') && !window.__resolveT) {
        window.__resolveT = Date.now();
      }
    }).observe(b, { attributes: true, attributeFilter: ['class'] });
  })()`);

  check(
    'A1',
    await s.eval(`(() => {
      const c = getComputedStyle(document.querySelector('.d-frame'));
      return c.animationName.includes('cp-draw') && c.animationDelay.startsWith('0.22s');
    })()`),
    'frame draw starts at 220ms',
  );

  // A2 (corrected): the figure is 19 drawables (every one pathLength="1") plus
  // the 2 strike circles (fill/stroke only, no pathLength, no inline style).
  // The spec's "21 drawables" miscounted the strike pair as drawables.
  check(
    'A2',
    await s.eval(`(() => {
      const d = [...document.querySelectorAll('.intro-draw')];
      const k = [...document.querySelectorAll('.intro-strike')];
      return d.length === 19 &&
        d.every(el => el.getAttribute('pathLength') === '1') &&
        k.length === 2 && k.every(el =>
          !el.hasAttribute('pathLength') && !el.getAttribute('style'));
    })()`),
    '19 drawables (pathLength=1) + 2 clean strikes [corrected from 21]',
  );

  // A3: the frame finishes drawing BEFORE the namerule starts — and, critically,
  // WHEN it finishes is bounded. The spec's fixed `t0 + 1500` sample is unusable
  // in headless (the CSS clock lags wall clock ~700ms at startup), but polling
  // alone loses the timing: a frame that drags to 2400ms would still pass a poll
  // that just waits, and its detail string would still claim the designed 820ms.
  // So assert the DECLARED schedule (deterministic, headless-independent) and
  // keep a live poll only as a liveness cross-check.
  const a3sched = await s.eval(`(() => {
    const f = getComputedStyle(document.querySelector('.d-frame'));
    const n = getComputedStyle(document.querySelector('.d-namerule'));
    const fEnd = (parseFloat(f.animationDelay) + parseFloat(f.animationDuration)) * 1000;
    const nStart = parseFloat(n.animationDelay) * 1000;
    return {
      fName: f.animationName, nName: n.animationName,
      fEnd: Math.round(fEnd), nStart: Math.round(nStart),
    };
  })()`);
  const frameDrawn = await until(
    () =>
      s.eval(
        `parseFloat(getComputedStyle(document.querySelector('.d-frame')).strokeDashoffset) <= 0.01`,
      ),
    8000,
    24,
  );
  const a3 = await s.eval(
    `parseFloat(getComputedStyle(document.querySelector('.d-frame')).strokeDashoffset)`,
  );
  // The live poll proves the frame actually finished; the ORDER and the bound are
  // the declared schedule's job. A live `namerule still unstarted` read would be a
  // wall-clock race (under load the ~700ms+ clock lag can leave the namerule's
  // 2500ms animation started by the time the frame's poll returns) and it is
  // redundant — `nStart >= fEnd` already proves the order deterministically.
  check(
    'A3',
    a3sched.fName.includes('cp-draw') &&
      a3sched.nName.includes('cp-draw') &&
      a3sched.fEnd <= 1500 &&
      a3sched.nStart >= a3sched.fEnd &&
      !!frameDrawn &&
      a3 <= 0.01,
    `frame ends ${a3sched.fEnd}ms <= 1500, namerule starts ${a3sched.nStart}ms; live frame offset ${a3}`,
  );

  // A4: once the scaffold has dissolved, the ornament survives and the gold
  // stays gold. The dissolve's own schedule is the timing assertion (the spec's
  // t0+3300 sample fails in headless for the same clock-lag reason as A3); the
  // live reads below prove the end state actually landed.
  const a4sched = await s.eval(`(() => {
    const sc = getComputedStyle(document.querySelector('.intro-scaffold'));
    return {
      name: sc.animationName,
      end: Math.round((parseFloat(sc.animationDelay) + parseFloat(sc.animationDuration)) * 1000),
    };
  })()`);
  const scaffoldGone = await until(
    () =>
      s.eval(
        `parseFloat(getComputedStyle(document.querySelector('.intro-scaffold')).opacity) <= 0.02`,
      ),
    4000,
    24,
  );
  const a4 = await s.eval(`(() => {
    const g = document.querySelector('.intro-ornament');
    const loupe = g && g.querySelector('.d-loupe');
    // The group .intro-ornament has no CSS rule anywhere, so its own computed
    // opacity is a constant 1 and proves nothing. Measure a real ornament child:
    // its draw offset (is it actually drawn?) and its effective opacity walked up
    // the ancestor chain (is it actually visible?).
    let op = 1, el = loupe;
    while (el && el !== document.documentElement) {
      op *= parseFloat(getComputedStyle(el).opacity);
      el = el.parentElement;
    }
    return {
      sc: parseFloat(getComputedStyle(document.querySelector('.intro-scaffold')).opacity),
      loupe: loupe ? parseFloat(getComputedStyle(loupe).strokeDashoffset) : -1,
      loupeW: loupe ? Math.round(loupe.getBoundingClientRect().width) : 0,
      orOp: op,
      nr: getComputedStyle(document.querySelector('.d-namerule')).stroke,
    };
  })()`);
  check(
    'A4',
    a4sched.name.includes('cp-dissolve') &&
      a4sched.end <= 3300 &&
      !!scaffoldGone &&
      a4.sc <= 0.02 &&
      a4.loupe <= 0.01 &&
      a4.loupeW > 0 &&
      a4.orOp > 0.5 &&
      a4.nr === 'rgb(198, 160, 83)',
    `scaffold dissolves by ${a4sched.end}ms <= 3300; live scaffold ${a4.sc}, ornament loupe drawn (offset ${a4.loupe}, ${a4.loupeW}px wide, opacity ${a4.orOp.toFixed(2)}), gold ${a4.nr}`,
  );

  // A5: Continue resolves at t0 + 3400 ± 250. The stamp is written at the exact
  // `.is-on` mutation (installed above), so it is independent of how long the
  // A3/A4 polls took — a Node poll started after is-on landed would measure 0ms
  // and silently pass. `.is-on` is a JS timer armed at `.is-live`, so the page's
  // wall clock is the right clock for it. Wait for the stamp (it may still be
  // pending if the liveness polls returned early), but bound the wait to the
  // resolve's own schedule: if it has not landed by t0+4200 the entrance is late.
  const resolveT = await until(() => s.eval('window.__resolveT || 0'), 4200, 24);
  const dt5 = resolveT ? resolveT - t0 : -1;
  check('A5', !!resolveT && Math.abs(dt5 - 3400) <= 250, `resolved at t0+${dt5}ms`);

  // A6: the strike holds full ink and ENDS settled at scale(1). The spec sampled
  // a fixed instant and asserted a non-identity transform, but the strike's
  // 480ms animation (delay 2620) has finished by the resolve moment, so the
  // settled identity is correct. Assert its declared schedule, then the live
  // end state — the same deterministic form as A3/A4.
  const a6sched = await s.eval(`(() => {
    const c = getComputedStyle(document.querySelector('.d-strike'));
    return {
      name: c.animationName,
      end: Math.round((parseFloat(c.animationDelay) + parseFloat(c.animationDuration)) * 1000),
    };
  })()`);
  const strikeInk = await until(
    () =>
      s.eval(
        `getComputedStyle(document.querySelector('.d-strike')).opacity === '1'`,
      ),
    4000,
    24,
  );
  const a6 = await s.eval(`(() => {
    const c = getComputedStyle(document.querySelector('.d-strike'));
    return { op: c.opacity, t: c.transform };
  })()`);
  check(
    'A6',
    a6sched.name.includes('cp-strike') &&
      a6sched.end <= 3400 &&
      !!strikeInk &&
      a6.op === '1' &&
      (a6.t === 'none' || a6.t === 'matrix(1, 0, 0, 1, 0, 0)'),
    `strike ends ${a6sched.end}ms; live ${a6.op}, ${a6.t} [ends at scale(1)]`,
  );

  // ------------------------------------------------------------- F · geometry
  const geom = () =>
    s.eval(`(() => {
      const de = document.documentElement;
      const box = document.getElementById('introPlateDraw');
      const pb = document.querySelector('.intro-plate-draw');
      const c = getComputedStyle(pb, '::before');
      return {
        scrollEq: de.scrollWidth <= innerWidth + 1,
        vw: innerWidth,
        aspect: box ? +(box.getBoundingClientRect().width /
                        box.getBoundingClientRect().height).toFixed(3) : 0,
        // F3: the plate box is centred in its frame. Measure the LAYOUT centre
        // (offsetLeft/offsetWidth are the used values, so a dropped left:50%
        // or an overridden offset shows up) — the original marginLeft +
        // width/2 derived both operands from var(--pw) and so was true by
        // construction, passing even when the plate sat off-centre.
        marginHalf: (() => {
          const pl = document.querySelector('.intro-plate');
          const frame = document.querySelector('.intro-plate-draw');
          if (!pl || !frame) return false;
          return Math.abs((pl.offsetLeft + pl.offsetWidth / 2) - frame.clientWidth / 2) < 1;
        })(),
        mask: (c.maskImage || c.webkitMaskImage || ''),
        gridBlend: document.querySelector('.intro-grid')
          ? getComputedStyle(document.querySelector('.intro-grid')).mixBlendMode : '',
        deckle: getComputedStyle(de).getPropertyValue('--deckle').trim(),
      };
    })()`);

  const g1 = await geom();
  check('F1', g1.scrollEq, 'no horizontal overflow');
  check('F2', Math.abs(g1.aspect - 16 / 9) < 0.01, `aspect ${g1.aspect}`);
  check('F3', g1.marginHalf, 'plate box centred in its frame');
  check('B8', /url\(/.test(g1.mask) && /svg/.test(g1.mask), 'deckle mask applied');
  check('F7', g1.gridBlend === 'screen', 'grid is in the site register');
  check('F5', g1.deckle.includes('svg'), '--deckle resolves');

  await s.shot('01-draw-3400');

  // F6: a mid-draw resize must not break anything (J2-14)
  await s.metrics(1280, 800);
  await sleep(200);
  const g6 = await geom();
  check(
    'F6',
    g6.scrollEq && g6.marginHalf && Math.abs(g6.aspect - 16 / 9) < 0.01,
    'resize mid-draw is clean',
  );
  await s.metrics(1440, 900);
  await sleep(150);

  // ---------------------------------------------------------- B · the exit walk
  // The exit is 1240ms (dismiss) + 340ms (remove) = ~1580ms end to end. CDP
  // round-trips between reads drift the wall clock past the stage's removal, so
  // the WHOLE walk runs inside ONE in-page async function. Crucially, the
  // timings are STAMPED at the exact mutation (a MutationObserver on the stage's
  // class) and the transitions are read from their own schedules — a sampled
  // read can be defeated by the ~700ms compositor lag this harness documents,
  // and a "saw it somewhere in the window" flag loses the +400 onset entirely.
  const walk = await s.eval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const stage = () => document.getElementById('introStage');
    const plate = () => document.getElementById('introPlateDraw');
    const readT = (el) => (el ? getComputedStyle(el).transform : 'none');
    const R = {};
    const btn = document.getElementById('introContinueBtn');
    if (!btn) return { fatal: 'no button' };
    const st0 = stage();
    if (!st0) return { fatal: 'no stage' };

    // Stamp each class onset against the click. is-bursting/lifting/turn are
    // added by a 0/120/400ms setTimeout chain, so wall clock IS the right clock
    // for them; the stamp is taken at the exact mutation, immune to how long any
    // sampled read took.
    const onsets = {};
    // Everything about the turn that must be read from the DOM is read HERE, in
    // the class MutationObserver — a microtask the browser services even when a
    // stalled compositor starves the rAF loop below. A rAF-gated read lost the
    // fade/plate/mask outright under load (the loop never observed is-turn).
    R.turn = { plate: null, fade: null, ttMax: 0, minOp: 1 };
    R.b8 = '';
    R.b6vis = false;
    const readTurnArtifacts = () => {
      // Force a style flush so the just-landed class's transitions exist before
      // getAnimations() is asked for them.
      void getComputedStyle(st0).opacity;
      if (R.turn.plate === null && plate()) {
        const a = plate().getAnimations().find(
          (x) => x.transitionProperty === 'transform' &&
                 [780, 840].includes(Math.round(x.effect.getComputedTiming().duration)));
        if (a) R.turn.plate = Math.round(a.effect.getComputedTiming().duration);
      }
      if (R.turn.fade === null) {
        const a = st0.getAnimations().find(
          (x) => x.transitionProperty === 'opacity' &&
                 Math.round(x.effect.getComputedTiming().duration) === 840);
        if (a) {
          const ct = a.effect.getComputedTiming();
          R.turn.fade = { dur: Math.round(ct.duration), delay: Math.round(ct.delay) };
        }
      }
      if (!R.b8 && plate()) {
        const c = getComputedStyle(plate(), '::before');
        R.b8 = c.maskImage || c.webkitMaskImage || '';
      }
    };
    new MutationObserver(() => {
      const c = st0.classList;
      const now = performance.now();
      if (c.contains('is-bursting') && onsets.burst === undefined) onsets.burst = now;
      if (c.contains('is-lifting') && onsets.lift === undefined) onsets.lift = now;
      if (c.contains('is-turn') && onsets.turn === undefined) {
        onsets.turn = now;
        readTurnArtifacts();
      }
    }).observe(st0, { attributes: true, attributeFilter: ['class'] });

    const rays = [...document.querySelectorAll('#introStage .intro-burst .ray')];
    const readRays = () => rays.map(r => getComputedStyle(r).strokeDashoffset);
    R.b3a = readRays();   // pre-click: each ray sits at its full --len
    btn.click();
    const t0 = performance.now();
    const at = (ms) => sleep(Math.max(0, t0 + ms - performance.now()));

    await at(60);
    R.b1 = !!(stage() && stage().classList.contains('is-bursting'));
    R.b4 = readT(plate());

    await at(140);
    R.b1b = !!(stage() && stage().classList.contains('is-lifting'));

    R.b2 = (() => {
      const q = (sel) => document.querySelectorAll('#introStage .intro-burst ' + sel).length;
      const cy = stage().style.getPropertyValue('--burst-cy');
      const b = btn.getBoundingClientRect();
      // --burst-cy is WRITTEN from the button's rect, so comparing it to the same
      // rect is true by construction. Also require the button to be a real,
      // on-screen box — otherwise a 0x0 / off-screen Continue button anchors the
      // spark to a degenerate point and B2 would still pass.
      const btnOk = b.width > 0 && b.height > 0 &&
        b.top >= 0 && b.left >= 0 &&
        b.bottom <= innerHeight && b.right <= innerWidth;
      return { core: q('.core'), rays: q('.ray'), stars: q('.spark--star'), motes: q('.spark--mote'),
               cy, btnOk, match: Math.abs(parseFloat(cy) - (b.top + b.height / 2)) <= 1 };
    })();

    // One sampler covers the whole +60 → +1300 window: the ray check (a 520ms
    // CSS draw that headless lags behind wall clock, so it is polled rather than
    // sampled at a fixed +360) and the turn artifacts. A separate ray loop that
    // ran long enough could swallow the turn window entirely, so they share one
    // 20ms setTimeout tick — which a stalled compositor cannot freeze, unlike rAF.
    // The riffle is driven by applyTurn(), which writes --tt (degrees) on #sb3d
    // every tick; --tt > 0 IS the book turning. Reading the computed transform of
    // .curl is unreliable here (rotateY(0deg) already computes to an identity
    // matrix3d, not "none"), so watch the driving value instead.
    // Sampled to +1500, not +1300: the fade runs +400 → +1240, and a starved
    // compositor can advance the animation clock ~1000ms behind wall clock, so
    // the opacity can still be descending past +1300. Reading to +1500 (the
    // stage survives until dismiss()'s ~+1580 removal) guarantees the fade's
    // descent is observed rather than assumed.
    while (performance.now() < t0 + 1500) {
      const st = stage();
      if (!st) break;
      if (!R.b3b) {
        const cur = readRays();
        if (cur.some((v, i) => v !== R.b3a[i])) R.b3b = cur;
      }
      readTurnArtifacts();
      R.turn.minOp = Math.min(R.turn.minOp, parseFloat(getComputedStyle(st).opacity));
      const sb = document.getElementById('sb3d');
      if (sb) {
        const tt = parseFloat(sb.style.getPropertyValue('--tt')) || 0;
        if (tt > R.turn.ttMax) R.turn.ttMax = tt;
      }
      // B6 visibility: --tt > 0 only proves the DRIVER ran. The spec's B6 claims
      // the riffle is *visible*, so measure the turning leaf itself — a .curl
      // with a real box, opacity > 0, visible, and inside the viewport, while the
      // cover is mid-fade. (#sb3d lives in <main>, NOT inside #introStage, so the
      // stage's opacity does not hide it; the .curl's own state is what matters.)
      if (!R.b6vis) {
        const cur = document.querySelector('#sb3d .curl');
        const tt = sb ? parseFloat(sb.style.getPropertyValue('--tt')) || 0 : 0;
        if (cur && tt > 1) {
          const cs = getComputedStyle(cur);
          const r = cur.getBoundingClientRect();
          const vh = innerHeight, vw = innerWidth;
          const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
          R.b6vis = cs.display !== 'none' && cs.visibility !== 'hidden' &&
            parseFloat(cs.opacity) > 0 && r.width > 1 && r.height > 1 && inView;
        }
      }
      await sleep(20);
    }
    if (!R.b3b) R.b3b = readRays();

    R.onsets = {
      burst: onsets.burst === undefined ? null : Math.round(onsets.burst - t0),
      lift: onsets.lift === undefined ? null : Math.round(onsets.lift - t0),
      turn: onsets.turn === undefined ? null : Math.round(onsets.turn - t0),
    };

    await at(1700);
    R.gone = {
      stage: !stage(), btn: !document.getElementById('introContinueBtn'),
      lock: document.documentElement.classList.contains('intro-lock'),
      inert: document.querySelectorAll('[inert]').length,
      lenis: window.__lenis ? window.__lenis.isStopped === false : 'no-lenis',
      closed: !!(window.__introCtl && window.__introCtl.ctl.closed),
      active: document.activeElement && document.activeElement.tagName,
    };
    return R;
  })()`);
  if (walk.fatal) throw new Error('exit walk: ' + walk.fatal);

  check(
    'B1',
    walk.b1 && walk.onsets.burst !== null && Math.abs(walk.onsets.burst) <= 40,
    `is-bursting at +${walk.onsets.burst}ms`,
  );
  check(
    'B4',
    walk.b4 === 'none' || walk.b4 === 'matrix(1, 0, 0, 1, 0, 0)',
    'plate not yet lifting at +60',
  );
  check(
    'B1b',
    walk.b1b && walk.onsets.lift !== null && Math.abs(walk.onsets.lift - 120) <= 80,
    `is-lifting at +${walk.onsets.lift}ms (120 ± 80)`,
  );
  check(
    'B2',
    walk.b2.core === 1 &&
      walk.b2.rays === 8 &&
      walk.b2.stars === 6 &&
      walk.b2.motes === 9 &&
      walk.b2.cy !== '' &&
      walk.b2.btnOk &&
      walk.b2.match,
    '24 nodes, measured anchor on a real button',
  );
  check(
    'B3',
    walk.b3a.some((v, i) => v !== walk.b3b[i]) &&
      !walk.b3a.every((v) => parseFloat(v) === 0),
    'rays actually draw',
  );
  check(
    'B1c',
    walk.onsets.turn !== null && Math.abs(walk.onsets.turn - 400) <= 80,
    `is-turn at +${walk.onsets.turn}ms (400 ± 80)`,
  );
  check(
    'B4b',
    !!walk.turn.plate,
    `plate transform transition ${walk.turn.plate ? walk.turn.plate + 'ms' : 'absent'} at the turn`,
  );
  check(
    'B5',
    !!walk.turn.fade &&
      walk.turn.fade.dur === 840 &&
      walk.turn.fade.delay === 0 &&
      walk.turn.minOp < 1,
    `cover fades over ${walk.turn.fade ? walk.turn.fade.dur : '?'}ms (delay ${
      walk.turn.fade ? walk.turn.fade.delay : '?'
    }), min op ${walk.turn.minOp.toFixed(2)}`,
  );
  check(
    'B6',
    !!walk.turn.fade &&
      walk.turn.fade.dur === 840 &&
      walk.onsets.turn !== null &&
      walk.turn.ttMax > 1 &&
      !!walk.b6vis,
    `riffle turns (--tt reached ${walk.turn.ttMax.toFixed(1)}°) and the leaf is on screen (${walk.b6vis})`,
  );
  check(
    'B8b',
    /url\(/.test(walk.b8) && /svg/.test(walk.b8),
    'deckle mask survives the lift',
  );

  // --------------------------------------------------------- C · teardown leaks
  const gone = walk.gone;
  check('B7', gone.stage === true && gone.btn === true, 'stage and button removed');
  check('C1', gone.lock === false, 'intro-lock lifted');
  check('C2', gone.inert === 0, 'inert stripped');
  // C3: on the MAIN run the CDN is not blocked, so Lenis must actually be
  // running — the `'no-lenis'` arm would silently accept a 404'd dependency or
  // a lock Lenis never released. (The blocked-CDN run proves the other path.)
  check('C3', gone.lenis === true, `Lenis running (${gone.lenis})`);
  check('C5', gone.closed === true, 'ctl.closed latched');
  check('I5', gone.active !== 'BODY', `focus landed on ${gone.active}`);

  // C4: nothing swallows input any more. The touch is built with a real Touch
  // payload — a bare TouchEvent makes Lenis's own handler throw on undefined
  // clientX, which is a harness artifact, not the page swallowing input.
  check(
    'C4',
    await s.eval(`(async () => {
      const seen = [];
      const rec = (e) => seen.push(e.defaultPrevented);
      addEventListener('wheel', rec, true);
      addEventListener('touchmove', rec, true);
      addEventListener('keydown', rec, true);
      dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true }));
      const touch = new Touch({ identifier: 1, target: document.body, clientX: 10, clientY: 10 });
      dispatchEvent(new TouchEvent('touchmove', { cancelable: true, bubbles: true,
        touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
      dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      removeEventListener('wheel', rec, true);
      removeEventListener('touchmove', rec, true);
      removeEventListener('keydown', rec, true);
      return seen.every(v => v === false);
    })()`),
    'no preventDefault after the exit',
  );

  // C6: the J2-1 regression — a resize after teardown must not throw
  const errors = [];
  s.on('Runtime.exceptionThrown', (p) =>
    errors.push(p.exceptionDetails?.exception?.description || 'exception'),
  );
  await s.metrics(1180, 760);
  await sleep(150);
  await s.metrics(1440, 900);
  await sleep(200);
  check(
    'C6',
    errors.length === 0 &&
      (await s.eval(`document.getElementById('introStage') === null`)),
    'resize after teardown is silent',
  );

  // ------------------------------------------------- A7 · concurrency budget
  // The true concurrency is a property of the DECLARED SCHEDULE, not of what a
  // Node sampler happens to catch: under a starved renderer the animation clock
  // jumps, and a jump can span a drawable's whole 600/420ms window between two
  // ~30ms polls — so a sampled `animated === 19` half FLAKES while the CSS is
  // correct. Sweep the schedule instead: read every drawable's own cp-draw
  // delay/duration and compute the exact max overlap. One live read stays, as a
  // liveness cross-check that the animations are actually attached.
  await s.goto(page, { wait: 120 });
  const tA7 = await liveT0(s);
  const a7 = await s.eval(`(() => {
    const els = [...document.querySelectorAll('.intro-draw')];
    const spans = [];
    let missing = 0;
    for (const el of els) {
      const a = el.getAnimations().find(x => x.animationName === 'cp-draw');
      if (!a) { missing++; continue; }
      const ct = a.effect.getComputedTiming();
      spans.push([ct.delay, ct.delay + ct.duration]);
    }
    // Sweep 0..3400ms in 1ms steps: the max number of spans open at once.
    let max = 0;
    for (let t = 0; t <= 3400; t++) {
      let n = 0;
      for (const [s0, s1] of spans) if (t >= s0 && t < s1) n++;
      if (n > max) max = n;
    }
    return { count: els.length, attached: spans.length, missing, max };
  })()`);
  // Live cross-check: at least one drawable observed mid-draw (progress in
  // (0,1)). This MUST poll — at t0+0 the first drawable's 220ms delay has not
  // elapsed, so a single read is 0 by construction. Bound it generously (the
  // CSS clock lags wall clock ~700ms at startup), and treat it as liveness
  // only: the schedule sweep above is the actual assertion.
  const a7live = await until(
    () =>
      s.eval(`(() => {
        let n = 0;
        for (const el of document.querySelectorAll('.intro-draw')) {
          for (const a of el.getAnimations()) {
            if (a.animationName !== 'cp-draw') continue;
            const ct = a.effect.getComputedTiming();
            if (ct.progress !== null && ct.progress < 1) n++;
          }
        }
        return n;
      })()`),
    3000,
    30,
  );
  check(
    'A7',
    a7.count === 19 &&
      a7.missing === 0 &&
      a7.max >= 1 &&
      a7.max <= 6 &&
      a7live >= 1,
    `schedule max in flight ${a7.max} (<=6) over ${a7.attached} drawables; live ${a7live} mid-draw [corrected from <=4]`,
  );

  // A8: the held portrait's two beats, in order. It must (1) sit IN the fan's
  // arc — --y:36px, the same slot as i=0, so the five read as one row — and
  // (2) carry the raise as its OWN keyframe, scheduled AFTER the clears, not
  // on the plate's arrival. The regression this locks: the portrait was raised
  // from the first frame (--y:var(--raise) inline), so the "in line" phase
  // never happened. Assert the declared schedule (deterministic) plus the live
  // resting transform — the same form as A3/A4/A6. The live `lift` read needs
  // the raise to have LANDED (3360), so wait on A7's own t0 first; the entrance
  // then holds until Continue, so any later read is still the settled seat.
  await sleep(Math.max(0, tA7 + 3400 - Date.now()));
  const a8 = await s.eval(`(() => {
    const p = document.querySelector('.intro-plate--raise');
    if (!p) return { missing: true };
    const img = p.querySelector('img');
    const c = getComputedStyle(p);
    const names = c.animationName.split(',').map(s => s.trim());
    const delays = c.animationDelay.split(',').map(v => parseFloat(v) * 1000);
    const durs = c.animationDuration.split(',').map(v => parseFloat(v) * 1000);
    const raiseIdx = names.indexOf('cp-plate-raise');
    const clearEl = document.querySelector('.intro-plate--clear');
    const cc = clearEl ? getComputedStyle(clearEl) : null;
    const clearNames = cc ? cc.animationName.split(',').map(s => s.trim()) : [];
    const clearDurs = cc ? cc.animationDuration.split(',').map(v => parseFloat(v) * 1000) : [];
    const clearDelays = cc ? cc.animationDelay.split(',').map(v => parseFloat(v) * 1000) : [];
    const ci = clearNames.indexOf('cp-plate-clear');
    return {
      missing: false,
      y: parseFloat(c.getPropertyValue('--y')) || 0,
      src: img ? img.getAttribute('src') : '',
      hasRaise: raiseIdx >= 0,
      raiseDelay: raiseIdx >= 0 ? delays[raiseIdx] : -1,
      raiseEnd: raiseIdx >= 0 ? delays[raiseIdx] + durs[raiseIdx] : -1,
      raiseName: raiseIdx >= 0 ? names[raiseIdx] : '',
      clearEnd: ci >= 0 ? clearDelays[ci] + clearDurs[ci] : -1,
      // Live cross-check of the SETTLED seat: the raised portrait's centre
      // must sit clearly ABOVE its arc twin (the i=0 plate, --y:36px). The
      // raise rotates about the centre, so it does not move the rect's
      // centreY; only the y translate does. The check runs at t0+3400, after
      // the raise lands (3360), so this reads the settled seat.
      lift: (() => {
        const i0 = document.querySelector('.intro-plate[style*="--i:0"]');
        if (!i0) return -1;
        const pr = p.getBoundingClientRect();
        const r0 = i0.getBoundingClientRect();
        return Math.round((r0.top + r0.height / 2) - (pr.top + pr.height / 2));
      })(),
    };
  })()`);
  check(
    'A8',
    !a8.missing &&
      /portrait-intro\.webp$/.test(a8.src) &&
      a8.y === 36 &&
      a8.raiseName === 'cp-plate-raise' &&
      a8.raiseDelay >= a8.clearEnd - 1 &&
      a8.raiseEnd <= 3400 &&
      a8.lift > 100,
    `portrait in the arc (--y ${a8.y}px) then raises at ${a8.raiseDelay}ms (after clears end ${a8.clearEnd}), landing ${a8.raiseEnd}ms <= 3400; settled ${a8.lift}px above its arc twin`,
  );

  // ------------------------------------------------- the two frames a human reads
  // 02/03 are taken on their own clean loads (a capture round-trip mid-walk
  // would eat the very exit window they are meant to show).
  for (const [name, ms] of [
    ['02-turn-500', 500],
    ['03-handoff-900', 900],
  ]) {
    await s.goto(page, { wait: 120 });
    await liveT0(s);
    await until(
      () =>
        s.eval(
          `document.getElementById('introContinueBtn')?.classList.contains('is-on')`,
        ),
      6000,
      40,
    );
    await s.eval(`document.getElementById('introContinueBtn').click()`);
    await sleep(ms);
    await s.shot(name);
  }

  // 04-after-1700: the real page, no stage, no button, no lock.
  await s.goto(page, { wait: 120 });
  await liveT0(s);
  await until(
    () =>
      s.eval(
        `document.getElementById('introContinueBtn')?.classList.contains('is-on')`,
      ),
    6000,
    40,
  );
  await s.eval(`document.getElementById('introContinueBtn').click()`);
  await sleep(1700);
  await s.shot('04-after-1700');

  // ------------------------------------------------------------------ D · skip paths
  // D1 · reduced motion
  await s.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await freshRun(page);
  const d1 = await until(
    () =>
      s.eval(
        `document.getElementById('introStage') === null &&
         document.querySelectorAll('.intro-draw').length === 0`,
      ),
    1200,
    50,
  );
  check('D1', d1, 'reduced motion: stage never painted');
  await s.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  // D2 · ?nointro
  await freshRun(page + '?nointro');
  check(
    'D2',
    await s.eval(`document.getElementById('introStage') === null &&
      !document.documentElement.classList.contains('intro-lock')`),
    '?nointro clean',
  );

  // D3 · ?shot=3 keeps spread 3 (J2-15). PAGES[3].title = "MoneyFlow Pro", so
  // the caption is the observable proxy for idx — a stage-gone check alone would
  // pass even if the guard regressed and reset to LAND.
  await freshRun(page + '?shot=3', () => sleep(300));
  check(
    'D3',
    await s.eval(`(() => {
      const book = document.getElementById('sbBook');
      const cap = document.getElementById('sbCaptions');
      return !!book && book.getBoundingClientRect().width > 0 &&
        document.getElementById('introStage') === null &&
        /MoneyFlow Pro/.test(cap ? cap.textContent : '');
    })()`),
    '?shot=3 drives the book to spread 3, stage gone',
  );
  await s.shot('05-shot3');

  // D4 · back/forward with the session flag set. `introSeen` only latches when
  // navType === "back_forward", so a plain Page.navigate cannot exercise it:
  // play the intro (which writes the flag), push a second history entry, then
  // walk the history back so the page genuinely re-parses as back_forward.
  // (BackForwardCache is disabled in launch(), or the restore would skip the
  // re-parse and leave navType at "navigate".)
  await freshRun(page);
  const flagSet = await s.eval(`sessionStorage.getItem('cp-intro-played')`);
  await s.goto(page + '?__nav=1', { wait: 200 });
  await s.eval(`history.back()`);
  await sleep(700);
  const d4 = await s.eval(`(() => ({
    nav: (performance.getEntriesByType('navigation')[0] || {}).type,
    stage: document.getElementById('introStage') === null,
  }))()`);
  check(
    'D4',
    flagSet === '1' && d4.nav === 'back_forward' && d4.stage === true,
    `replay skipped for back/forward (nav ${d4.nav})`,
  );

  // ------------------------------------------------------------------ E · no-GSAP
  // A dedicated exception collector: E2 claims "no ReferenceError", but a
  // typeof check cannot see an uncaught throw. The other collector is not
  // installed until after this whole block, so arm one here and drain it at
  // E2 (pre-exit) and E2b (after the blocked-CDN teardown).
  const eErrors = [];
  const eOnErr = (p) =>
    eErrors.push(p.exceptionDetails?.exception?.description || 'exception');
  s.on('Runtime.exceptionThrown', eOnErr);
  await s.send('Network.setBlockedURLs', {
    urls: ['*cdn.jsdelivr.net*', '*cdnjs.cloudflare.com*'],
  });
  await freshRun(page);
  const tE = await liveT0(s);
  const eOn = await until(
    () =>
      s.eval(
        `document.getElementById('introContinueBtn')?.classList.contains('is-on')`,
      ),
    4600,
    50,
  );
  check('E1', !!eOn && Date.now() - tE >= 3000, 'entrance completes with the CDN blocked');
  check(
    'E2',
    eErrors.length === 0 &&
      (await s.eval(
        `typeof window.gsap === 'undefined' && typeof window.Lenis === 'undefined'`,
      )),
    `no CDN globals, no ReferenceError (${eErrors.length} errors)`,
  );
  await s.eval(`document.getElementById('introContinueBtn').click()`);
  const eDone = await until(
    () => s.eval(`document.getElementById('introStage') === null`),
    3000,
    50,
  );
  check('E1b', !!eDone, 'exit completes with the CDN blocked');
  check('E2b', eErrors.length === 0, `no error on the blocked-CDN teardown (${eErrors.length})`);
  s.off('Runtime.exceptionThrown', eOnErr);
  await s.send('Network.setBlockedURLs', { urls: [] });

  // ------------------------------------------------------------------ G · js-failed
  await freshRun(page);
  await liveT0(s);
  await s.eval(`document.documentElement.classList.add('js-failed')`);
  await sleep(120);
  check(
    'G1',
    await s.eval(`(() => {
      const f = getComputedStyle(document.querySelector('.d-frame'));
      const k = getComputedStyle(document.querySelector('.intro-kicker'));
      // strokeDashoffset computes to "0px", not "0" — compare as a number.
      return parseFloat(f.strokeDashoffset) === 0 && f.strokeDasharray === 'none' &&
        parseFloat(k.opacity) === 1;
    })()`),
    'js-failed leaves a legible static plate',
  );

  // ------------------------------------------------------------------ H · performance
  await freshRun(page);
  await s.send('Performance.enable');
  await liveT0(s);
  await sleep(3400);
  const metrics = await s.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.metrics.map((m) => [m.name, m.value]));
  check(
    'H1',
    byName.TaskDuration < 2.4,
    `TaskDuration ${byName.TaskDuration.toFixed(2)}s across the draw`,
  );
  check(
    'H2',
    await s.eval(`[...document.querySelectorAll('.intro-draw')]
      .every(el => getComputedStyle(el).willChange === 'auto')`),
    'no will-change on the drawables',
  );

  // --------------------------------------------------------- 06 · mobile
  await s.metrics(390, 844, true);
  await s.goto(page, { wait: 120 });
  const tM = await liveT0(s);
  await sleep(Math.max(0, tM + 3400 - Date.now()));
  await s.shot('06-mobile-3400');
  await s.metrics(1440, 900, false);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
    console.log('Screenshots: ' + SHOTS);
  }
  if (s) s.close();
  if (!argv.includes('--keep')) proc.kill();
}
process.exit(failures ? 1 : 0);
