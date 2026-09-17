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

### AWS (S3 + CloudFront), lowest cost

`deploy/aws/template.yaml` creates a private S3 bucket, a CloudFront distribution with the security headers, a CloudFront Function for clean URLs and an SPA fallback. `deploy/aws/deploy.sh` creates or updates the stack, builds with the right `VITE_SITE_URL`, uploads with correct cache headers and invalidates the cache.

```bash
aws configure            # once
bash deploy/aws/deploy.sh
```

The script prints the `https://xxxx.cloudfront.net` URL. For a custom domain, request a free ACM certificate in `us-east-1` (`aws acm request-certificate --region us-east-1 --domain-name tools.example.com --validation-method DNS`), add the validation CNAME at your DNS provider, then:

```bash
DOMAIN=tools.example.com CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/... bash deploy/aws/deploy.sh
```

Add `HOSTED_ZONE_ID=Z...` if the domain is in Route 53 and the alias records should be created for you, and `ALT_DOMAIN=www.tools.example.com` to also serve `www` (it redirects to the bare domain).

**Domain bought elsewhere (GoDaddy, Namecheap, …).** A bare domain (`example.xyz`) cannot be a CNAME, and most registrars lack ALIAS records, so host the DNS in Route 53 ($0.50/month) or Cloudflare (free, DNS-only mode) and point the registrar's nameservers there. With Route 53: create the hosted zone, switch the nameservers at the registrar, request the ACM certificate for both `example.xyz` and `www.example.xyz` in `us-east-1`, add its validation records to the zone, wait for `ISSUED`, then deploy with `DOMAIN`, `ALT_DOMAIN`, `CERT_ARN` and `HOSTED_ZONE_ID` set. With Cloudflare: add CNAME records for `@` and `www` pointing at the CloudFront hostname (DNS only, grey cloud), add the ACM validation CNAMEs, and deploy without `HOSTED_ZONE_ID`.

**IAM user for deploying.** `deploy/aws/deploy-policy.json` is a least-privilege policy: it can manage the `ihateimage` CloudFormation stack and the resources it creates (buckets named `ihateimage-*`, the distribution, its function and headers policy), upload objects, and invalidate the cache. Nothing else in the account. Replace `ACCOUNT_ID` and `REGION`, then:

```bash
sed -e "s/ACCOUNT_ID/$(aws sts get-caller-identity --query Account --output text)/g" -e "s/REGION/us-east-1/g" deploy/aws/deploy-policy.json > /tmp/ihateimage-deploy-policy.json
aws iam create-policy --policy-name ihateimage-deploy --policy-document file:///tmp/ihateimage-deploy-policy.json
aws iam create-user --user-name ihateimage-deploy
aws iam attach-user-policy --user-name ihateimage-deploy --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/ihateimage-deploy
aws iam create-access-key --user-name ihateimage-deploy
aws configure --profile ihateimage      # paste the key; then: AWS_PROFILE=ihateimage bash deploy/aws/deploy.sh
```

Run those as your admin identity once; deploy with the `ihateimage` profile afterwards. If you deploy from GitHub Actions, attach the same policy to an IAM role trusted by GitHub's OIDC provider instead of creating access keys. The last statement (ACM and Route 53) is only needed for a custom domain and can be deleted otherwise.

Cost: CloudFront's always-free tier covers 1 TB/month of transfer, 10M requests and 2M function invocations; S3 storage for the ~30 MB bundle is about a cent. Without a custom domain the bill rounds to $0. With one, Route 53 adds $0.50/month per hosted zone plus the domain registration. The AI models are downloaded from Hugging Face, not from your bucket, so they don't count against your transfer.

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
