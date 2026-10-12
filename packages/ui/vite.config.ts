import process from 'node:process'

import { fileURLToPath } from 'node:url'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

import { defineConfig } from 'vite'

/**
 * Builds the web UI into `dist/client/`, the directory `startViewer` serves at `/`.
 *
 * `pnpm dev:client` serves the UI with HMR and proxies `/api` to a running viewer server
 * (`VIEVAL_VIEWER_API`, default `http://127.0.0.1:51204`, the port of `vieval viewer`).
 */
export default defineConfig({
  base: './',
  build: {
    // NOTICE:
    // Fonts must stay files. Vite inlines assets under 4 KiB as `data:` URIs, which caught three small Fontsource
    // subsets, and the viewer serves the UI with `Content-Security-Policy: default-src 'self'` (`src/server/files.ts`,
    // `CLIENT_CONTENT_SECURITY_POLICY`) without a `font-src data:` allowance, so the browser refused those faces.
    // Removal condition: none while the CSP keeps `data:` out of `font-src`.
    assetsInlineLimit: filePath => (/\.woff2?$/.test(filePath) ? false : undefined),
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
  },
  plugins: [Vue(), UnoCSS({ configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)) })],
  root: fileURLToPath(new URL('./client', import.meta.url)),
  server: {
    proxy: {
      '/api': process.env.VIEVAL_VIEWER_API ?? 'http://127.0.0.1:51204',
    },
  },
})
