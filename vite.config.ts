import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundling these breaks their internal wasm/asset resolution via import.meta.url.
    exclude: ['@imgly/background-removal', 'onnxruntime-web'],
  },
})
