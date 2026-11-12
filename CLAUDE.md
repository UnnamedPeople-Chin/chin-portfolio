# chin-portfolio

Portofolio pribadi **Jizdan Yuflikh Rachmat** — full-stack developer & AI engineer.
Satu halaman statis, dibungkus shell Vite, di-deploy ke Vercel.

- **Live:** https://www.jizdanyr.my.id/ (alias Vercel: `chin-portfolio-evrt.vercel.app`)
- **Repo:** `UnnamedPeople-Chin/chin-portfolio`
- **Bahasa kerja:** jawab dalam Bahasa Indonesia. Identifier kode, path, perintah, dan pesan error tetap verbatim.

---

## 1. Arsitektur inti — BACA DULU

**Seluruh situs adalah satu file HTML:** `public/landing-pages/chin-portfolio.html` (~12.300 baris).
Markup, CSS, dan JS semuanya inline di file itu. Tidak ada framework, tidak ada build step untuk app-nya.
Tailwind **tidak** dipakai. `shadcn` ada di devDependencies tapi tidak dipakai oleh halaman ini.

Artinya: setiap perubahan visual/behavioral hampir selalu berarti edit file itu, di baris yang tepat.
Sebelum mengedit, cari dulu section-nya (lihat peta section di §5), jangan menebak dari struktur file.

### Kenapa `index.html` ada tapi dihapus dari build

`index.html` di root **hanya untuk dev server.** Isinya cuma
`<script>location.replace('/landing-pages/chin-portfolio.html')</script>` plus fallback `<noscript>`.

Plugin `serve-portfolio-at-root` di [vite.config.ts](vite.config.ts) melakukan tiga hal:

1. `configureServer` — rewrite request `/` dan `/index.html` ke `/landing-pages/chin-portfolio.html`.
2. `generateBundle` — `delete bundle['index.html']`.
3. `writeBundle` — hapus `dist/index.html` kalau html plugin tetap menulisnya ke disk.

**Kenapa harus dihapus:** kalau ada file statis di `/` dalam `dist/`, ia akan menutupi rewrite
`/` → `/landing-pages/chin-portfolio.html` di `vercel.json`, dan setiap pengunjung dipaksa lewat
shell + `location.replace()` (satu hop ekstra, flash). Jangan pernah "memperbaiki" ini dengan
mengembalikan `index.html` ke bundle.

### Alur routing produksi (`vercel.json`)

- Rewrite: `/` → `/landing-pages/chin-portfolio.html`
- Redirect permanen: `/index.html` → `/`, `/landing-pages/chin-portfolio.html` → `/`
  (URL kanonik tunggal; link lama ke path file akan dialihkan ke root)

Header per-route juga di sana: CSP, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/payment/usb
semuanya `()`), `X-Frame-Options: DENY`, dan cache `immutable` 1 tahun untuk `/assets/*`,
`stale-while-revalidate` untuk `/chin-portfolio/*`.

**CSP saat ini** (verbatim, dari `vercel.json`):

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'self' https://cdn.jsdelivr.net; frame-src https://www.youtube-nocookie.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
```

> **Jebakan:** setiap host/CDN baru yang mau dipakai (font eksternal, API, iframe, analytics)
> **harus** ditambahkan ke CSP dan ke `connect-src`/`img-src`/`frame-src` yang sesuai, kalau tidak
> request-nya diblokir diam-diam di produksi. Di dev tidak terlihat karena Vite tidak memasang CSP.
> Perhatikan `media-src 'self'` — video self-hosted OK, video/CDN eksternal tidak.

---

## 2. Perintah

```bash
npm run dev       # vite dev server, port 5173, host terbuka (bisa diakses dari HP di LAN)
npm run build     # vite build -> dist/ (tanpa index.html)
npm run preview   # serve dist/ lokal
```

Tidak ada test runner, tidak ada linter, tidak ada CI.

---

## 3. Aturan repo

- **DILARANG menambahkan atribusi tool apa pun** ke commit message atau body PR. Tidak ada
  `Co-Authored-By: …claude/anthropic…`, tidak ada `Generated with Claude Code`, tidak ada
  penyebutan Claude/Anthropic di mana pun. Tulis sebagai suara user. Selesai di baris konten
  terakhir, tanpa trailer.
  Sudah ditegakkan otomatis oleh hook lokal [.git/hooks/commit-msg](.git/hooks/commit-msg) yang
  membuang baris atribusi sebelum commit dibuat.
- **Jangan `git add -A`.** Stage per path eksplisit. Banyak direktori untracked yang besar dan
  tidak boleh ikut masuk (lihat §7).
- Commit/push hanya kalau user memintanya. Force-push butuh konfirmasi eksplisit.
- Riwayat git: 72 commit, satu author (`jizdanyr354@gmail.com`), **nol** trailer co-author.
  Tidak ada atribusi AI di history. (Sudah diverifikasi menyeluruh — jangan ulangi investigasinya.)

---

## 4. Sistem warna & tipografi

Blok token ada di `:root` sekitar baris **228–283** di `chin-portfolio.html`.

```css
--ground:#0B1120;  --surface:#1A2340;  --surface-mid:#141C33;  --surface-hover:#222C4E;
--paper:#0B1120;   /* alias — JS membaca --paper untuk DESK */
--ink:#EFE7D6;     --ink-soft:rgba(239,231,214,.60);  --ink-faint:rgba(239,231,214,.48);
--hairline:rgba(239,231,214,.16);  --earth:#C6A053;
/* varian khusus teks — pakai INI untuk teks kecil */
--ink-soft-text:rgba(239,231,214,.74);  --ink-faint-text:var(--ink-soft-text);  --earth-text:#DDBE78;
--accent:#C6A053;  --accent-text:#DDBE78;  --accent-ink:#10172B;
--display:'Instrument Serif',"New York",Georgia,'Times New Roman',serif;
--font:'Switzer',"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
--track-caps:.24em;  --track-nav:.06em;
--ease-out:cubic-bezier(.25,.46,.45,.94);
--ease-soft:cubic-bezier(.22,.61,.36,1);
--ease-std:cubic-bezier(.4,0,.2,1);
--deckle:url("data:image/svg+xml,...");   /* GENERATED — jangan edit tangan */
```

### Aturan kontras (jangan dilanggar)

- `--ink-faint` (alpha `.48`) **tidak pernah** untuk teks — hanya 4,26:1, di bawah WCAG AA.
- Semua teks kecil pakai varian `*-text` pada alpha `.74` (8,64:1 di atas `--ground`).
- Selalu pakai token. Jangan hardcode hex di komponen.

### `--deckle` itu generated

Masker tepi kertas itu dihasilkan [tools/gen-deckle-mask.mjs](tools/gen-deckle-mask.mjs)
(rebuild lewat script itu, lalu tempel hasilnya). Jangan pernah menyunting data-URI-nya manual.
Hal yang sama untuk aset di `tools/gen-ornament-plates.py` dan `tools/gen-signature.py`.

### Aksen per-proyek

Token `--accent`, `--accent-text`, `--accent-ink` diregister sebagai `@property` sehingga bisa
dianimasikan. Fungsi `setActiveAccent(i)` menukar aksen mengikuti item yang aktif. Perpindahan
halus karena kelas `.has-accent-transition` memberi transisi `.5s` — kelas ini dihapus saat
`prefers-reduced-motion: reduce` supaya aksen langsung ganti tanpa animasi.

---

## 5. Peta halaman

| Baris (kira-kira) | Section / elemen |
|---|---|
| 4455 | `#introStage` — overlay intro, riffle buku, chip dismiss |
| 4740 | `#sketchbook.hero` — buku 3D yang bisa di-drag/turn |
| 4944 | `#about` |
| 5042 | `#plates` — cloud plat/ornamen |
| 5113 | `#contact.contact-section` |
| 5448+ | markup modal proyek (`.project-modal-backdrop`, `.project-modal`, `#modalCloseBtn`, `.modal-hero`, `#modalProjectImg`) |
| 5506 | `projectsData` (lihat §6) |

`index.html` root tidak relevan untuk konten.

### Kelompok JS penting (semua inline di `<script>` yang sama)

- **Intro:** `initIntroStage`, `startRiffle`, `revealThenDismiss`, `resolveIntro`, `enterPage`,
  `fitToBook`, `swallowScroll`, `onIntroKey`.
- **Buku 3D:** `buildCurl`, `applyTurn`, `paint`, `animateTo`, `tweenTo`, `tick`, `kick`,
  `applyView`, `viewSpring`, `setView`, `tiltTo`, `bookRect`, `hideHint`, `endDrag`, `startTurn`.
- **Modal proyek:** `openProjectModal`, `closeProjectModal`, `setModalBackgroundInert`,
  `restoreModalFocus` (jangan hapus `restoreModalFocus` — ini fix commit `d9f6160`).
- **Kontak:** `initBounceCards` (failsafe DOM) dan `initContactRing` (ring orbit sungguhan).
  Markup BounceCards adalah fallback; `html.cc-live` yang menukar keduanya. Class helper di ring:
  `measure`, `computeTiles`, `build`, `placeStrip`, `render`, `advance`, `focusIndex`, `stepBy`.
- **Kartu proyek / lensa:** `collectLensItems`, `writeLens`, `updateLens`, `queueLens`,
  `generateScatteredPositions`, `createParticleBurst`, `marks`.
- **Enhancement bertahap:** `idleInit(key, fn)` menunda pekerjaan berat sampai idle.
  `initGsapEnhance` (GSAP + Lenis), `initBloomParallax`, `initPlateCloudAnimation`,
  `initScrollSpy`, `motionOK()`, `lockScroll()`.
- **3D/GLTF (bagian bawah file):** `loadScript`, `loadLibs`, `mount`, `disposePivot`, `tick`,
  `setPicking`, `repairHalo`, `textureHasAlpha`. Library di-load dari jsDelivr, jadi hostnya
  harus tetap ada di `script-src` CSP.

---

## 6. `projectsData` — satu-satunya sumber data proyek

Didefinisikan inline di `chin-portfolio.html` sekitar baris **5506** sebagai literal JS.
(Ada `fetch("/data/projects.json")` yang sudah dihapus — data di-inline untuk menghilangkan satu
round-trip dan satu file yang bisa drift. Jangan kembalikan fetch itu.)

Entri ada di baris ~5524, 5530, 5536, 5542, 5548.

Ada **dua bentuk** `video:` yang didukung modal:

```js
// 1. Facade YouTube — dipakai AetherCast. Iframe baru dibuat setelah pengguna klik,
//    supaya tidak ada koneksi ke YouTube saat load awal.
video: { youtubeId: "DsPyzpgbho8", poster: "/chin-portfolio/starwars-ar-video-poster.webp" }

// 2. Video self-hosted — dipakai Schedule Organizer.
video: {
  src:    "/chin-portfolio/schedule-organizer-demo.mp4",
  poster: "/chin-portfolio/schedule-organizer-video-poster.webp",
  duration: "0:30"
}
```

`frame-src https://www.youtube-nocookie.com` di CSP hanya untuk bentuk (1).
Menambah sumber video baru: taruh file di `public/chin-portfolio/`, pakai bentuk (2), dan
pastikan `media-src 'self'` masih cukup (tidak perlu diubah kalau file self-hosted).

---

## 7. Aset

`public/` disalin apa adanya ke `dist/`. Nama folder di `public/` = nama path di produksi.

- `public/chin-portfolio/` — **66 aset.** Per proyek: `*-480.webp`, `*-800.webp`, `*-modal.webp`.
  Lainnya: `schedule-organizer-demo.mp4`, `schedule-organizer-video-poster.webp`, font
  (`instrument-serif*.woff2`), favicon + `site.webmanifest`, `backsound.mp3`, `og-image.jpg`
  (1200×630), `portrait-intro.webp`, partikel/ornamen webp, `engraved/*`.
- `public/plates/` — **untracked.** 4 mp4 untuk keperluan film: `app-panel.mp4`,
  `app-panel-crop.mp4`, `app-skeleton.mp4`, `app-take.mp4`.
- `public/landing-pages/chin-portfolio.html` — situsnya.
- `/assets/*` di produksi maksudnya folder `dist/assets/` hasil build Vite (header cache
  `immutable`). Ini **bukan** folder yang ada di repo.

### Aturan LCP / preload

`portrait-intro.webp` di-preload (itu elemen LCP). `bg-wash.webp` **sengaja tidak** di-preload —
jangan tambahkan, itu akan menurunkan prioritas LCP. Font yang di-preload hanya
`instrument-serif.woff2` dan `instrument-serif-italic.woff2`.

### Head / meta

`<title>Jizdan YR — Full-Stack Developer & AI Engineer</title>`,
`<meta name="theme-color" content="#0B1120">`, `<meta name="color-scheme" content="dark">`,
OG canonical `https://www.jizdanyr.my.id/`, `og-image.jpg` 1200×630.

---

## 8. Workstream yang belum di-commit

Direktori ini ada di working tree tapi **belum di-track** dan tidak boleh ikut ke commit
kecuali user memintanya secara eksplisit:

| Path | Isi | Status |
|---|---|---|
| `film/` | 343 file — film AetherCast 30 detik | kerjaan aktif |
| `pieces/aethercast-promo/` | 6 file | eksperimen |
| `styles/aether/` | 1 file | eksperimen |
| `unslop/` | 7 file — screenshot before/after + `original.html` | arsip audit UI |
| `tools/film-shoot/` | 16 file — `camtest.cjs`, `gates.py`, `inject*.cjs`, `measure.cjs` | harness film |
| `tools/animation-styles/` | `reference-styles.md` | catatan referensi |
| `public/plates/` | 4 mp4 | bahan film |

Perubahan `.gitignore` yang belum di-commit menambahkan: `references/`, `pieces/*/frames/`,
`pieces/*/renders/`. `shots/` dan cache Python sudah diabaikan lewat commit `3bb1aec`.

### `film/` — film produk AetherCast

Baca [film/NOTE.md](film/NOTE.md) sebelum menyentuh apa pun di situ. Ringkasnya:

- Deliverable: `film/final.mp4` (salinan dari `film/out/v53.mp4`).
- 1920×1080, 30 fps, 900 frame. Remotion + Playwright (dev-only deps).
- **Aturan plate 1:1:** setiap frame film memetakan 1:1 ke frame plate. Melanggar ini
  menyebabkan playback 0,55× yang lolos semua gate otomatis tapi terasa salah dibanding app-nya.
- Dua bug timing yang sudah diperbaiki (jangan regresi): plate span yang tumpang tindih
  menyebabkan lompatan mundur di cut; dan 124 frame film di atas 68 frame plate.
- Sembilan beat — tabelnya di NOTE.md (frame film / waktu / plate / beat / apa yang dibeli).

Konfigurasi Remotion/React 19 ada di `dependencies` (bukan devDependencies) di `package.json`,
dan `playwright` masih uncommitted.

---

## 9. Skill & konvensi agen

- `.claude/` — direktori skill, ada `.claude/settings.local.json`.
- `.agents/rules/graphify.md` — aturan graphify.
- `.git/hooks/commit-msg` — hook non-sample yang membuang baris atribusi Claude/Anthropic.
  `core.hooksPath` tidak di-set (pakai default `.git/hooks`).
- Tidak ada `CLAUDE.md`/`README.md` lain di repo — file ini satu-satunya.

### Aturan kerja yang berlaku

- **Eksekusi serial.** Jangan memanggil tool/subagent/background task secara paralel.
- **Hemat konteks.** Jangan `cat` seluruh file. Pakai `sed -n 'start,endp'` atau `head -n 50`.
  Selalu pipe output shell ke `grep`/`head`/`tail`.
- **Jangan pernah mulai** rencana WebGL lens carousel untuk section kontak
  (`~/.claude/plans/polymorphic-exploring-hippo.md`) — itu tidak berhubungan.
- `.tmp-enc/` adalah scratch untracked — jangan di-commit.

---

## 10. Cara kerja yang disarankan untuk agen berikutnya

1. **Cari, jangan tebak.** `grep -n` di `chin-portfolio.html` dulu untuk menemukan section/fungsi,
   baru `sed -n` baris di sekitarnya. File 12k baris; jangan pernah baca utuh.
2. **Satu file, satu sumber.** Kalau mengubah teks/konten proyek, tempatnya di `projectsData`
   (baris ~5506), bukan di markup modal.
3. **Aset baru** → `public/chin-portfolio/`, lalu rujuk dengan path absolut `/chin-portfolio/...`.
4. **Host/CDN baru** → update CSP di `vercel.json`, kalau tidak akan diblokir diam-diam di prod.
5. **Token warna** → pakai `--accent`/`--ink-soft-text`/`--earth-text`; jangan hardcode, jangan
   pakai `--ink-faint` untuk teks.
6. **Verifikasi di dev server** (`http://localhost:5173/`), lalu `npm run build` dan pastikan
   `dist/index.html` **tidak ada** sebelum menganggap build benar.
7. **Commit** dengan pesan bergaya user, tanpa atribusi, stage per path.
