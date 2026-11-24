import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const API_TARGET = process.env.AVE_API_URL ?? 'http://127.0.0.1:8787';
const ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read .env from the repo root (one file for server and web). Only VITE_* variables reach the browser.
  envDir: ROOT,
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    // One copy of three for the tour, drei and the avatar.
    dedupe: ['three', 'react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [ROOT] },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET.replace(/^http/, 'ws'), ws: true },
    },
  },
  // The try-on inference worker is an ES module worker with its own imports.
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
