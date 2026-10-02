# Claude Code Instructions — Chin Portfolio

## ⚠️ Canonical Architecture (Single Source of Truth)

The live portfolio website is located at:
👉 `public/landing-pages/chin-portfolio.html`

**DO NOT build React components or iframe wrappers in `src/`.**
When users open `http://localhost:5173/`, `index.html` loads `public/landing-pages/chin-portfolio.html`. Any code placed in `src/` (like React components or postMessage bridges) is **NOT** executed by the browser.

---

## 📁 How to Make Changes That Show Up Immediately

### 1. Adding / Editing Projects (CMS)
- Edit `src/data/projects.json` (and keep `public/data/projects.json` in sync).
- Each project object schema:
  ```json
  {
    "id": "project-slug",
    "title": "Project Title",
    "tagline": "Tech · Stack · Info",
    "description": "Full description...",
    "image": "chin-portfolio/image-name.png",
    "techStack": ["Tag1", "Tag2"],
    "tags": ["/tag-name"],
    "links": { "github": "https://...", "demo": "https://..." },
    "year": 2024
  }
  ```
- Any new tag added to `tags` or `skills` automatically appears in the floating cloud and opens the project detail modal when clicked.

### 2. Styling, Layout, Animation, or HTML Changes
- Edit `public/landing-pages/chin-portfolio.html` directly.
- All styles (`<style>`), markup, and scripts are inside this file.
- Changes to this file trigger Vite HMR immediately or show up on browser refresh.

### 3. Image Transparency Rule
- Sketchbook spreads (`portrait-intro.webp`, `aethercast.webp`, `starwars-ar.webp`, `moneyflow.webp`, `schedule-organizer.webp`) **MUST** remain alpha-transparent `.webp` (or `.png`).
- **NEVER** change them to `.jpg`, because JPG lacks transparency and produces ugly solid green corners around the curved sketchbook pages.
- These were converted from near-raw PNG to alpha `.webp` (7.75 MB → 725 KB, 91% smaller) with the alpha channel verified byte-identical. Particle sprites (`particle-*.webp`) are capped at 128px because they are only ever drawn at 20–38 CSS px.

---

## 🛠️ Verification Command
Run `npm run build` to verify clean build before finishing tasks.
