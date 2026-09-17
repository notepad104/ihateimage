import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Last line of defence: a crash in one tool should never leave a blank page.
 * Nothing is reported anywhere; there is no telemetry in this app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ihateimage crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          The page hit an unexpected error. Your images were never uploaded, so nothing has left your device. Reloading
          usually fixes it.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-700">
          {this.state.error.message}
        </pre>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Reload
          </button>
          <a href="/" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Back to all tools
          </a>
        </div>
      </div>
    )
  }
}
