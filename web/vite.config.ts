import path from 'node:path'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // --host: доступ с других ПК в локальной сети.
    // HTTPS (самоподписанный): без него браузер не отдаст микрофон по http.
    host: true,
    port: 5173,
    // В dev бэкенд и LiveKit доступны напрямую; фронт стучится на те же пути
    // (в проде их проксирует Caddy — код не меняется).
    proxy: {
      '/api': 'http://localhost:8090',
      '/rtc': { target: 'ws://localhost:7880', ws: true },
    },
  },
})
