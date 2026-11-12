// Mobile check for the project modal video: `npm run check:modal`.
//
// The item this replaces was "test it on a phone". Emulation catches the
// failures that actually bite here — the facade never swapped for a <video>,
// a src typo, poster missing, or the file not being served — because they are
// all DOM/network facts, not rendering ones.
//
// Real-device-only gaps this does NOT cover: Safari's autoplay policy with a
// soundtrack, and the CSP headers, which only exist in vercel.json (Vite dev
// and preview serve without them).
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5199
const URL = `http://localhost:${PORT}/?nointro`
// Spawn Vite's entry with node directly: going through `npx` inserts a cmd.exe
// that survives server.kill(), and the orphan held the repo open (moves failed
// with EPERM until it was killed by hand).
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })

const fail = (m) => { console.error('check:modal failed — ' + m); cleanup(1) }
function cleanup(code) {
  server.kill()
  setTimeout(() => process.exit(code), 150)   // let the child die before exit
}

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(URL); return true } catch { await new Promise(r => setTimeout(r, 250)) }
  }
  return false
}
if (!(await up())) fail('dev server never answered')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },   // iPhone 13 CSS px
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'load' })

// Both clicks go through dispatchEvent: the plate that opens the modal is a
// carousel item that may be mid-animation, and Playwright's actionability wait
// would time out on it. The handlers only care about the event.
await page.evaluate(() => {
  const li = document.querySelector('[data-project-index]')
  const cards = [...document.querySelectorAll('[data-project-index]')]
  const target = cards.find((el) => /moneyflow/i.test(el.textContent || '')) || li
  const btn = target.querySelector('button, [role="button"], a') || target
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})

const facade = await page.waitForSelector('.video-facade', { timeout: 5000 }).catch(() => null)
if (!facade) fail('no video facade after opening the modal (wrong project, or buildModalVideo skipped)')

const posterOk = await page.evaluate(() => {
  const img = document.querySelector('.video-facade img')
  return !!img && img.complete && img.naturalWidth > 0
})
if (!posterOk) fail('facade poster did not load')

await page.evaluate(() => document.querySelector('.video-facade')
  .dispatchEvent(new MouseEvent('click', { bubbles: true })))

const info = await page.waitForFunction(() => {
  const v = document.querySelector('.video-frame video, video')
  if (!v) return null
  if (v.readyState < 2) return null
  return { src: v.getAttribute('src'), duration: v.duration, w: v.videoWidth, h: v.videoHeight }
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null)

if (!info) fail('<video> never reached readyState 2 (src missing, 404, or codec unsupported)')
if (!/moneyflow-promo\.mp4$/.test(info.src || '')) fail(`unexpected src: ${info.src}`)
if (Math.abs(info.duration - 60) > 1) fail(`duration ${info.duration}s, expected 60`)
if (info.w !== 1280 || info.h !== 720) fail(`video is ${info.w}x${info.h}, expected 1280x720`)

const blocking = errors.filter((e) => !/favicon|preload/i.test(e))
if (blocking.length) fail('console errors: ' + blocking.join(' | '))

await browser.close()
console.log(`check:modal ok — facade → <video ${info.w}x${info.h} ${info.duration.toFixed(1)}s> on a 390 px viewport`)
cleanup(0)
