import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// A Content Security Policy for the built app (the WebView and the browser build). Only the hosts the app really calls are allowed:
// live prices, exchange rates and the optional Gemini AI. Development is left out because Vite's dev server needs inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'", // pdf.js may compile WebAssembly; no inline or remote scripts
  "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'connect-src \'self\' https://query1.finance.yahoo.com https://open.er-api.com https://generativelanguage.googleapis.com',
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'justmoney-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
})
