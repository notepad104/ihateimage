import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  plugins: [react(), tailwindcss(), cspPlugin()],
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
