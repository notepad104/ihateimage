import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">That tool doesn't exist (yet).</p>
      <Link to="/" className="mt-6 inline-block font-medium text-brand-700 hover:underline">
        Back to all tools
      </Link>
    </div>
  )
}
