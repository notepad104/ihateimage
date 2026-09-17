/**
 * Prerender every route of the SPA to static HTML so crawlers (and users on
 * slow connections) get real content, a per-page <title>, description,
 * canonical URL, Open Graph tags and JSON-LD without executing JavaScript.
 *
 * Runs after `vite build` and the SSR build. Reads dist/index.html as the
 * template and writes dist/<route>/index.html for each page plus sitemap.xml.
 */
import { mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const serverDir = join(dist, 'server')

const template = await readFile(join(dist, 'index.html'), 'utf8')
const { render, ALL_PAGES, structuredData, absoluteUrl, SITE_URL } = await import(
  pathToFileURL(join(serverDir, 'entry-server.js')).href
)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// "</script" inside JSON would close the data block; escape the slash.
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

function headFor(page) {
  const url = absoluteUrl(page.path)
  return [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:site_name" content="ihateimage" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    ...structuredData(page).map(jsonLd),
  ].join('\n    ')
}

function stripTemplateHead(html) {
  // Remove the generic title/description/og tags from the template; each page injects its own.
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
    .replace(/<meta\s+property="og:(title|description|type)"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:card"[^>]*>\s*/i, '')
}

const base = stripTemplateHead(template)
let written = 0
for (const page of ALL_PAGES) {
  const appHtml = render(page.path)
  const head = `${headFor(page)}\n    <meta property="og:type" content="website" />\n    <meta name="twitter:card" content="summary" />`
  const html = base
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
  if (page.path === '/') {
    await writeFile(join(dist, 'index.html'), html, 'utf8')
  } else {
    // Both layouts so every host resolves /route without a redirect:
    //   /route/index.html  (directory index: Netlify, Cloudflare, GitHub Pages, nginx)
    //   /route.html        (clean URLs: Vercel, Vite preview, Cloudflare)
    const slug = page.path.replace(/^\//, '')
    await mkdir(join(dist, slug), { recursive: true })
    await writeFile(join(dist, slug, 'index.html'), html, 'utf8')
    await writeFile(join(dist, `${slug}.html`), html, 'utf8')
  }
  written++
}

// 404 page for hosts that serve one (GitHub Pages, S3): the SPA shell handles unknown routes.
await writeFile(join(dist, '404.html'), base, 'utf8')

const today = new Date().toISOString().slice(0, 10)
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  ALL_PAGES.map(
    (p) =>
      `  <url><loc>${esc(absoluteUrl(p.path))}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>${
        p.path === '/' ? '1.0' : '0.8'
      }</priority></url>`,
  ).join('\n') +
  `\n</urlset>\n`
await writeFile(join(dist, 'sitemap.xml'), sitemap, 'utf8')
await appendFile(join(dist, 'robots.txt'), `Sitemap: ${SITE_URL}/sitemap.xml\n`)

// The SSR bundle must not be deployed.
await rm(serverDir, { recursive: true, force: true })

console.log(`Prerendered ${written} pages + 404.html + sitemap.xml (${SITE_URL})`)
