import { ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { TOOLS } from '../lib/tools'
import { cx } from './ui'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span>
              ihate<span className="text-brand-600">image</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {TOOLS.map((t) => (
              <NavLink
                key={t.id}
                to={t.path}
                className={({ isActive }) =>
                  cx(
                    'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {t.name}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nothing leaves your device</span>
            <span className="sm:hidden">Private</span>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            All processing happens locally in your browser using Canvas, Web Workers and WebAssembly. No files are
            uploaded, stored or tracked.
          </p>
          <p className="shrink-0">Re-encoding strips EXIF metadata, including GPS location.</p>
        </div>
      </footer>
    </div>
  )
}
