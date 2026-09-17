import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { absoluteUrl, seoForPath, TOOL_SEO, type PageSeo } from '../lib/seo'
import { TOOLS } from '../lib/tools'

function setMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta')
    document.head.appendChild(el)
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
}

/** Keeps <head> in sync with the route on the client. Prerendered HTML already has these; this handles navigation. */
export function useSeo(pathname: string) {
  useEffect(() => {
    const page = seoForPath(pathname)
    if (!page) return
    document.title = page.title
    setMeta('meta[name="description"]', { name: 'description', content: page.description })
    setMeta('link[rel="canonical"]', { rel: 'canonical', href: absoluteUrl(page.path) })
    setMeta('meta[property="og:title"]', { property: 'og:title', content: page.title })
    setMeta('meta[property="og:description"]', { property: 'og:description', content: page.description })
    setMeta('meta[property="og:url"]', { property: 'og:url', content: absoluteUrl(page.path) })
  }, [pathname])
}

/**
 * Indexable, genuinely useful copy shown under each tool: how it works, FAQ and
 * related tools. The prerenderer bakes this into the static HTML for crawlers.
 */
export function ToolGuide({ page }: { page: PageSeo }) {
  const related = page.related.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean) as typeof TOOLS
  return (
    <section aria-labelledby="guide-heading" className="mx-auto mt-14 max-w-7xl border-t border-slate-200 px-4 pt-10 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-10">
          <div>
            <h2 id="guide-heading" className="text-xl font-semibold text-slate-900">
              How to {page.h1.toLowerCase()} online without uploading
            </h2>
            <p className="mt-2 max-w-3xl text-slate-600">{page.intro}</p>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {page.steps.map((s, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Frequently asked questions</h2>
            <dl className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {page.faqs.map((f) => (
                <div key={f.q} className="px-4 py-3">
                  <dt className="font-medium text-slate-900">{f.q}</dt>
                  <dd className="mt-1 text-sm text-slate-600">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <aside>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Related tools</h2>
          <ul className="mt-3 space-y-2">
            {related.map((t) => {
              const Icon = t.icon
              const seo = TOOL_SEO[t.id]
              return (
                <li key={t.id}>
                  <Link
                    to={t.path}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-brand-300"
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.tint}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{t.name}</span>
                      <span className="block text-xs text-slate-500">{seo?.description.split('.')[0] ?? t.tagline}.</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </section>
  )
}
