import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4666,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4667',
        changeOrigin: true,
      },
    },
  },
  build: {
    emptyOutDir: true,
  },
})
