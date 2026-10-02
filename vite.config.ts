import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-portfolio-at-root',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/landing-pages/chin-portfolio.html';
          }
          next();
        });
      }
    }
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
})
