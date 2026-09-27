import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

/**
 * Tesseract (OCR) runs in a classic worker that loads its WebAssembly core by
 * URL, so those files have to be served from this origin under a stable path
 * rather than bundled. This plugin serves them from node_modules in dev and
 * copies them into dist/ocr for the build. The English language file lives in
 * public/ocr next to them.
 */
const OCR_FILES: Record<string, string> = {
  'worker.min.js': join(dirname(require.resolve('tesseract.js/package.json')), 'dist', 'worker.min.js'),
  ...Object.fromEntries(
    ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].flatMap((name) =>
      ['.wasm.js', '.wasm'].map((ext) => [
        `${name}${ext}`,
        join(dirname(require.resolve('tesseract.js-core/package.json')), `${name}${ext}`),
      ]),
    ),
  ),
}

function ocrAssetsPlugin(): Plugin {
  let outDir = 'dist'
  let ssr = false
  return {
    name: 'ihateimage-ocr-assets',
    configResolved(config) {
      outDir = config.build.outDir
      ssr = Boolean(config.build.ssr)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/ocr\/([\w.-]+)$/.exec(req.url?.split('?')[0] ?? '')
        const file = m && OCR_FILES[m[1]]
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (ssr) return
      const dir = join(outDir, 'ocr')
      mkdirSync(dir, { recursive: true })
      for (const [name, file] of Object.entries(OCR_FILES)) copyFileSync(file, join(dir, name))
    },
  }
}

/**
 * Content Security Policy for the production bundle.
 *
 * Everything is first-party except the on-device model files, which are
 * fetched from Hugging Face (MI-GAN object fill, IS-Net background removal).
 * 'wasm-unsafe-eval' is required to instantiate WebAssembly (ONNX Runtime).
 * blob: in script-src and connect-src is needed because the wasm
 * runtime loads its glue module and binary through blob URLs; blob URLs can
 * only be minted by script that is already running on this origin, so this
 * does not open an injection path.
 * There are no inline scripts or styles in the build, so neither
 * 'unsafe-inline' nor nonces are needed.
 *
 * The same policy is mirrored in public/_headers, vercel.json and
 * deploy/nginx.conf so hosts that support headers also enforce
 * frame-ancestors, which a <meta> tag cannot express.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' blob: https://huggingface.co https://*.hf.co",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ')

/** Injects the CSP <meta> tag into index.html for production builds only (the dev server needs inline HMR scripts). */
function cspPlugin(): Plugin {
  let isBuild = false
  return {
    name: 'ihateimage-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      if (!isBuild) return html
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin(), ocrAssetsPlugin()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundling breaks ONNX Runtime's wasm resolution via import.meta.url.
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Large AI runtimes are already split via dynamic import(); silence the size warning.
    chunkSizeWarningLimit: 1500,
  },
  preview: {
    headers: {
      'Content-Security-Policy': `${CSP}; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
