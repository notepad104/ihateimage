/**
 * Build-time entry used by scripts/prerender.mjs to turn every route into
 * static HTML. Nothing here runs in the browser.
 */
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from './App.tsx'

export { ALL_PAGES, structuredData, absoluteUrl, SITE_URL } from './lib/seo'

export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
  )
}
