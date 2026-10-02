import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, unlinkSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-portfolio-at-root',
      // `enforce: 'post'` so this runs after Vite's built-in html plugin, which
      // emits index.html into the bundle last.
      enforce: 'post',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/landing-pages/chin-portfolio.html';
          }
          next();
        });
      },
      // The live site is the static file public/landing-pages/chin-portfolio.html.
      // index.html only exists as the Vite dev-server entry for the (unused in
      // production) React app in src/. Emitting it to dist/ makes it a *static
      // file at "/"*, which shadows the "/" -> portfolio redirect in vercel.json
      // and forces every visitor through a shell + location.replace() hop.
      // Dropping it lets the redirect do its job (and removes the dead React
      // bundle from the deployed output). No-JS users are covered by the 308.
      generateBundle(_options, bundle) {
        for (const name of Object.keys(bundle)) {
          // Drop the shell and its now-orphaned chunks. The deployed page is the
          // static public/landing-pages/chin-portfolio.html, which references no
          // /assets/ files, so every JS/CSS chunk the React build emits is dead
          // weight (nothing on the visitor path fetches it).
          if (name === 'index.html' || /\.(js|css)$/.test(name)) {
            delete bundle[name]
          }
        }
      },
      // Belt-and-braces: if the html plugin still writes anything to disk, remove it.
      writeBundle(options) {
        const dir = resolve(options.dir ?? 'dist')
        const html = resolve(dir, 'index.html')
        if (existsSync(html)) unlinkSync(html)
        const assets = resolve(dir, 'assets')
        if (existsSync(assets)) rmSync(assets, { recursive: true, force: true })
      }
    }
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
})
