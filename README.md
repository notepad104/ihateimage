# ihateimage

Free image tools that run entirely in your browser: compress, resize, crop to a ratio, convert, rotate, scan documents from photos, beautify, add watermarks, remove objects or backgrounds, and view or strip EXIF and GPS data. Nothing is uploaded. No accounts, no analytics.

Live at https://ihateimage.xyz.

## How it works

- Pixel work runs in Web Workers with OffscreenCanvas on the user's device. SVG input is drawn to a bitmap on the page first (workers cannot decode SVG), then flows through the same pipeline.
- The AI features (background removal, object fill, document corner detection) run on-device through ONNX Runtime Web. Their models download once from Hugging Face and are cached; every model file is pinned by SHA-256.
- Document scanning finds the page outline (classic edge analysis or the DocAligner model), estimates the page's real proportions from the perspective, warps it flat and whitens the paper.
- The production bundle ships with a strict Content Security Policy and no third-party scripts.
- Every route is prerendered to static HTML at build time with its own title, description and structured data, plus a generated sitemap, so search engines see real pages.

## Develop

```bash
npm ci
npm run dev
```

Node 20 or newer. The dev server runs on http://localhost:5173.

## Build

```bash
npm run build      # type-check, bundle, prerender all routes
npm run preview    # serve dist/ locally with the production headers
```

Set the public origin so canonical URLs and the sitemap point at your domain:

```bash
VITE_SITE_URL=https://ihateimage.xyz npm run build
```

## Deploy

The output in `dist/` is a static site. Any host works as long as unknown paths fall back to `index.html`; configs are included for Netlify and Cloudflare (`public/_headers`, `public/_redirects`), Vercel (`vercel.json`) and Docker with nginx (`Dockerfile`, `deploy/nginx.conf`).

### AWS

Production runs on S3 + CloudFront, which sits inside CloudFront's free tier. `deploy/aws/template.yaml` defines the infrastructure; `deploy/aws/deploy.sh` creates or updates it, builds, uploads and invalidates the cache.

Manual deploy:

```bash
DOMAIN=ihateimage.xyz ALT_DOMAIN=www.ihateimage.xyz CERT_ARN=<acm-arn> HOSTED_ZONE_ID=<zone-id> bash deploy/aws/deploy.sh
```

Leave the variables out to deploy to the default `*.cloudfront.net` URL. `deploy/aws/deploy-policy.json` is a least-privilege IAM policy for whoever runs this.

### Continuous deployment

Every push to `main` deploys automatically through `.github/workflows/deploy.yml`. GitHub authenticates to AWS with a short-lived OIDC token, so no AWS keys are stored in GitHub. The role it assumes is defined in `deploy/aws/github-oidc.yaml`, and the deploy settings live in the repository's Actions variables (`AWS_DEPLOY_ROLE_ARN`, `DOMAIN`, `ALT_DOMAIN`, `CERT_ARN`, `HOSTED_ZONE_ID`). Pull requests run `ci.yml` (type check, audit, build) without deploying.

## Security

- Strict CSP: same-origin scripts only (plus WebAssembly), connections only to the origin and the model host, no inline scripts, framing disabled. Defined once in `vite.config.ts` and mirrored in every host config.
- Standard hardening headers: nosniff, `X-Frame-Options: DENY`, referrer policy, Permissions-Policy, HSTS.
- Image files are decoded by the browser's own codecs. The metadata parsers are bounds-checked, written EXIF fields are sanitized, and download and ZIP names cannot contain paths.
- No `innerHTML`; all user-derived text goes through React's escaping.
- `npm run audit` fails on high or critical advisories and runs in CI.

## Browser support

Chrome, Edge, Firefox and Safari 16.4 or newer. AVIF encoding is available where the browser supports it. The AI tools use WebGPU when present and fall back to WebAssembly.
