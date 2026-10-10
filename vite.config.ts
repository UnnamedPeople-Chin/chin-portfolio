import { defineConfig } from 'vite'
import { existsSync, unlinkSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
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
      // index.html is only the dev-server entry that forwards "/" to it; it must
      // not land in dist/, where a static file at "/" would shadow the
      // "/" -> portfolio rewrite in vercel.json and force every visitor through a
      // shell + location.replace() hop. Dropping it keeps dist/ to the static
      // files copied from public/.
      generateBundle(_options, bundle) {
        delete bundle['index.html']
      },
      // Belt-and-braces: if the html plugin still writes anything to disk, remove it.
      writeBundle(options) {
        const dir = resolve(options.dir ?? 'dist')
        const html = resolve(dir, 'index.html')
        if (existsSync(html)) unlinkSync(html)
      }
    }
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
})
