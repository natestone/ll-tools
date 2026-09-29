import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // bind 0.0.0.0 so the host Mac can reach it at http://<vm-ip>:5173
    port: 5173,
    // The project lives on a VMware shared folder (/mnt/hgfs), where inotify
    // events never fire. Without polling Vite silently serves stale modules —
    // it had been shipping a RoleView that used WeekPicker without importing it,
    // because one edit invalidated the module graph and a later one didn't.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
