import { ArrowRight, Cpu, Lock, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { TOOLS } from '../lib/tools'

export function Home() {
  return (
    <>
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            <Lock className="h-3.5 w-3.5" /> 100% in your browser · no uploads · no accounts
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Every tool you need to work with images, without giving them away
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Compress, resize, crop, convert, rotate and remove backgrounds. Your files never leave this tab, so it's
            fast, free and private by design.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.id}
                to={t.path}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${t.tint}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-900">{t.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{t.tagline}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100">
                  Open tool <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-3 sm:p-8">
          <Feature
            icon={Lock}
            title="Private by architecture"
            body="There is no server to upload to. Images are read by your browser, edited on your CPU/GPU, and saved back to your disk."
          />
          <Feature
            icon={Zap}
            title="No waiting on uploads"
            body="Processing starts instantly and runs in parallel on background threads. Batch hundreds of photos without a progress bar for the network."
          />
          <Feature
            icon={Cpu}
            title="Real codecs, real AI"
            body="Native JPEG, PNG, WebP and AVIF encoders, plus an on-device neural network for background removal. Nothing is faked."
          />
        </div>
      </section>
    </>
  )
}

function Feature({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </div>
  )
}
