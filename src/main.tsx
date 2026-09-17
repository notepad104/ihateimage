import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const container = document.getElementById('root')!
const app = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)

// Production pages are prerendered to static HTML; hydrate them instead of re-rendering from scratch.
if (container.hasChildNodes()) hydrateRoot(container, app)
else createRoot(container).render(app)
