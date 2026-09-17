# ihateimage

Private image tools that run entirely in the browser. Compress, resize, crop to a ratio, convert, rotate, beautify, add watermarks, remove objects or backgrounds, and edit or strip EXIF and GPS metadata. No uploads, no accounts, no analytics.

## How it stays private

- All pixel work happens in Web Workers with OffscreenCanvas on the user's machine.
- The two AI features (background removal with IS-Net, object fill with MI-GAN) run on-device through ONNX Runtime Web (WebGPU when available, WebAssembly otherwise). Their model files are downloaded once from Hugging Face and cached; the image itself is never sent anywhere.
- Every model file is pinned by SHA-256 and size. A swapped or corrupted download is rejected before the runtime ever parses it.
- No third-party scripts, fonts, or trackers. The production bundle ships with a strict Content Security Policy.

## Develop

```bash
npm ci
npm run dev
```

Node 20 or newer. The dev server runs on http://localhost:5173.

## Build and verify

```bash
npm run typecheck
npm run build
npm run preview
```

`npm run build` type-checks first and then emits `dist/`. `npm run preview` serves `dist/` with the same security headers the deploy targets use, so CSP problems show up locally as console violations.

## Deploy

The output is a static single-page app. Every route must fall back to `index.html`.

| Host | What's included |
| --- | --- |
| Netlify, Cloudflare Pages | `public/_headers` (security headers) and `public/_redirects` (SPA fallback) are copied into `dist/` automatically. Publish directory: `dist`. |
| Vercel | `vercel.json` sets the same headers and rewrites. |
| Docker / any VM | `Dockerfile` builds the bundle and serves it with unprivileged nginx on port 8080 using `deploy/nginx.conf`. `npm run docker:build && npm run docker:run`. Put TLS termination in front and enable the HSTS line in the config. |
| Other static hosts (S3 + CloudFront, GitHub Pages, …) | Upload `dist/`, configure a 200 rewrite of unknown paths to `/index.html`, and add the headers from `public/_headers` at the edge. The CSP is also embedded in `index.html` as a `<meta>` tag, so the policy holds even where custom headers are impossible; only `frame-ancestors` requires a real header. |

Cache policy: `/assets/*` files are content-hashed and can be cached forever; `index.html` must not be cached.

## Security notes

- **Content Security Policy**: `default-src 'self'`; scripts only from the same origin plus `'wasm-unsafe-eval'` for WebAssembly and `blob:` for the runtime's glue module (blob URLs can only be created by script already running on the origin, so this adds no injection vector); connections only to the origin, `blob:` (same reasoning) and the model host (`huggingface.co`, `*.hf.co`); no inline scripts or styles; `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `frame-ancestors 'none'`. The policy is defined once in `vite.config.ts` and mirrored in the host configs.
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, HSTS with preload.
- **Untrusted input**: image files are decoded by the browser's own codecs. The EXIF/PNG/WebP container parsers are bounds-checked with hard caps on chunk counts and sizes, so truncated or hostile files fail gracefully. Metadata fields written by the user are limited to printable ASCII and bounded length. Download and ZIP entry names are sanitized (no path separators, traversal, control characters).
- **Rendering**: the UI never uses `innerHTML`; all user-derived strings (file names, metadata values) go through React's escaping. Watermark text is drawn on a canvas, not into the DOM.
- **Dependencies**: `npm run audit` fails on high or critical advisories; CI runs it on every push.
- **No secrets**: there is nothing server-side and no API keys anywhere in the app.

## SEO

Search engines get real HTML, not an empty shell:

- `npm run build` prerenders every route to `dist/<route>/index.html` and `dist/<route>.html` via a small server-side render (`src/entry-server.tsx`, `scripts/prerender.mjs`), so each URL resolves to real HTML on every host without redirects. Each page ships its own `<title>`, meta description, canonical URL, Open Graph tags and JSON-LD (`WebApplication` on the home page; `HowTo`, `FAQPage` and `BreadcrumbList` on tool pages).
- Every tool page carries indexable how-to steps, an FAQ and related-tool links (`src/lib/seo.ts`). Edit the copy there; titles should stay under 60 characters and descriptions under 155.
- `dist/sitemap.xml` and a `Sitemap:` line in `robots.txt` are generated at build time.
- Set the public origin at build time so canonical URLs and the sitemap point at your domain:

```bash
VITE_SITE_URL=https://your-domain.example npm run build
```

After deploying, submit the sitemap in Google Search Console and Bing Webmaster Tools. Rankings for competitive queries like "compress image" also depend on backlinks and Core Web Vitals; the prerendered pages are lightweight and load without waiting for JavaScript, which helps the latter.

## Browser support

Chrome, Edge, Firefox and Safari 16.4 or newer. AVIF encoding is available where the browser supports it (Chrome and Edge). Object fill uses WebGPU when present and falls back to WebAssembly.
