import { useEffect, useRef, useState } from 'react'
import { BATCHES, validate, toRow } from '../shared/validate.js'


const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// Shrinks a phone screenshot to a small JPEG before upload (fast on mobile data, well under the 2 MB limit).
async function compress(file) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  let out = c.toDataURL('image/jpeg', 0.82)
  if (out.length > 1_800_000) out = c.toDataURL('image/jpeg', 0.45)
  return out
}

const EMPTY = { fullName: '', batch: '', studentId: '' }

const fieldCls = (err) =>
  `w-full rounded-xl border bg-white/[0.04] px-4 py-3.5 text-base text-zinc-100 placeholder:text-zinc-600 outline-none transition
   focus:bg-white/[0.06] focus:ring-4 ${err
     ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-500/15'
     : 'border-white/10 hover:border-white/20 focus:border-violet-400 focus:ring-violet-500/20'}`

function Field({ id, label, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-zinc-300">{label}</label>
      {children}
      <p id={`${id}-err`} role={error ? 'alert' : undefined} className="mt-1.5 min-h-5 text-sm text-rose-300">{error}</p>
    </div>
  )
}

export default function App() {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState(null) // { type: 'success' | 'error' | 'demo', message }
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)
  const [backend, setBackend] = useState('checking') // checking | ready | demo | offline
  const [proof, setProof] = useState(null)
  const [preview, setPreview] = useState('')
  const lock = useRef(false)

  useEffect(() => {
    fetch('/api/health').then((r) => r.json())
      .then((d) => setBackend(d.configured ? 'ready' : 'demo'))
      .catch(() => setBackend('offline'))
  }, [])

  const set = (k) => (ev) => {
    const next = { ...values, [k]: ev.target.value }
    setValues(next)
    if (errors[k]) setErrors((p) => ({ ...p, [k]: validate(next)[k] }))
    if (status?.type !== 'success') setStatus(null)
  }

  function pickProof(ev) {
    const file = ev.target.files?.[0]
    if (preview) URL.revokeObjectURL(preview)
    setProof(null); setPreview('')
    if (!file) return
    if (!file.type.startsWith('image/')) return setErrors((p) => ({ ...p, proof: 'Choose an image (screenshot).' }))
    if (file.size > 15 * 1024 * 1024) return setErrors((p) => ({ ...p, proof: 'That image is too large. Choose a smaller one.' }))
    setProof(file); setPreview(URL.createObjectURL(file))
    setErrors((p) => ({ ...p, proof: undefined }))
  }

  async function onSubmit(ev) {
    ev.preventDefault()
    if (lock.current || done) return // duplicate-submission guard
    const errs = validate(values)
    if (!proof) errs.proof = 'Upload the required screenshot.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    lock.current = true
    setLoading(true)
    setStatus(null)
    try {
      const res = await post('/api/register', { ...values, proof: await compress(proof) })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) setDone(data.registration)
      else if (res.status === 503 && data.code === 'not_configured')
        setStatus({ type: 'demo', message: 'Demo mode: details passed validation, but nothing was saved.' })
      else if (res.status === 409) setStatus({ type: 'error', message: 'This student ID is already registered.' })
      else if (res.status === 400 && data.errors) setErrors(data.errors)
      else if (res.status === 429) setStatus({ type: 'error', message: 'Too many attempts. Wait a minute and try again.' })
      else setStatus({ type: 'error', message: data.message || 'Registration failed. Try again.' })
    } catch {
      setStatus({ type: 'error', message: 'Registration failed. Check your connection and try again.' })
    } finally {
      lock.current = false
      setLoading(false)
    }
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview)
    setDone(null); setValues(EMPTY); setErrors({}); setStatus(null); setProof(null); setPreview('')
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-zinc-100">
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-violet-600/25 blur-[140px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-52 right-0 h-[30rem] w-[30rem] rounded-full bg-indigo-600/15 blur-[140px]" />

      <main className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
        <section className="settle">
          <h1 className="font-display font-extrabold leading-[0.82] tracking-[-0.05em]">
            <span className="block whitespace-nowrap bg-gradient-to-br from-white via-violet-200 to-violet-500 bg-clip-text text-[clamp(3.5rem,18vw,10rem)] text-transparent">Sci-Mat</span>
            <span className="mt-3 block text-[clamp(1.75rem,5vw,3rem)] tracking-[-0.03em] text-zinc-400">Open Sourcery</span>
          </h1>
          <p className="mt-8 max-w-sm text-lg leading-relaxed text-zinc-400">
            Add your name, batch and student ID to register. It takes under a minute.
          </p>
        </section>

        <section className="settle settle-late" aria-labelledby="form-title">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.015] p-6 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-9">
            {(backend === 'demo' || backend === 'offline') && (
              <div role="status" className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-snug text-amber-200">
                {backend === 'demo'
                  ? <><strong className="font-semibold">Demo mode.</strong> The server has no database configured, so nothing you submit is saved.</>
                  : <><strong className="font-semibold">Server unreachable.</strong> Registrations cannot be saved right now.</>}
              </div>
            )}

            {done ? (
              <div className="pop" role="status">
                <div className="mb-6 grid h-12 w-12 place-items-center rounded-full bg-violet-500/15 ring-1 ring-violet-400/40">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-violet-300" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </div>
                <h2 id="form-title" className="font-display text-3xl font-bold tracking-tight">Registration received, {done.full_name.split(' ')[0]}.</h2>
                <dl className="mt-6 divide-y divide-white/10 border-y border-white/10 text-sm">
                  <div className="flex justify-between py-3"><dt className="text-zinc-500">Name</dt><dd>{done.full_name}</dd></div>
                  <div className="flex justify-between py-3"><dt className="text-zinc-500">Batch</dt><dd>{done.batch}</dd></div>
                  <div className="flex justify-between py-3"><dt className="text-zinc-500">Student ID</dt><dd>{done.student_id}</dd></div>
                </dl>
                <p className="mt-4 text-sm leading-relaxed text-zinc-400">Your registration and screenshot have been received.</p>
                <button onClick={reset} className="mt-6 text-sm font-medium text-violet-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-violet-400">
                  Register another student
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <h2 id="form-title" className="font-display text-3xl font-bold tracking-tight">Register</h2>
                <p className="mb-7 mt-1.5 text-sm text-zinc-500">All fields are required.</p>

                <div className="space-y-1">
                  <Field id="fullName" label="Full name" error={errors.fullName}>
                    <input id="fullName" type="text" autoComplete="name" placeholder="Name" value={values.fullName} onChange={set('fullName')}
                      disabled={loading} aria-invalid={!!errors.fullName} aria-describedby="fullName-err" className={fieldCls(errors.fullName)} />
                  </Field>

                  <Field id="batch" label="Batch" error={errors.batch}>
                    <div className="relative">
                      <select id="batch" value={values.batch} onChange={set('batch')} disabled={loading}
                        aria-invalid={!!errors.batch} aria-describedby="batch-err"
                        className={`${fieldCls(errors.batch)} appearance-none pr-11 ${values.batch ? '' : 'text-zinc-600'}`}>
                        <option value="" disabled>Select batch</option>
                        {BATCHES.map((b) => <option key={b} value={b} className="bg-zinc-900 text-zinc-100">{b}</option>)}
                      </select>
                      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l5 5 5-5" /></svg>
                    </div>
                  </Field>

                  <Field id="studentId" label="Student ID" error={errors.studentId}>
                    <input id="studentId" type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="240XXX" value={values.studentId} onChange={set('studentId')}
                      disabled={loading} aria-invalid={!!errors.studentId} aria-describedby="studentId-err" className={fieldCls(errors.studentId)} />
                  </Field>
                </div>

                <figure className="my-6 overflow-hidden rounded-2xl border border-white/10 bg-white p-3">
                  <img
                    src="/upi-payment-qr.png"
                    alt="UPI payment QR code for Himank Jain"
                    className="mx-auto w-full max-w-sm rounded-xl"
                  />
                  <figcaption className="px-2 pt-3 text-center text-sm text-zinc-600">
                    Scan to pay with any UPI app
                  </figcaption>
                </figure>

                <Field id="proof" label="Required screenshot" error={errors.proof}>
                  <div className="mt-2 flex items-center gap-3">
                    <input id="proof" type="file" accept="image/*" onChange={pickProof} disabled={loading}
                      aria-invalid={!!errors.proof} aria-describedby="proof-err"
                      className="block w-full min-w-0 text-sm text-zinc-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-violet-500/15 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-violet-200 hover:file:bg-violet-500/25" />
                    {preview && <img src={preview} alt="Selected screenshot" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-white/15" />}
                  </div>
                </Field>

                {status && (
                  <p role={status.type === 'error' ? 'alert' : 'status'} className={`pop mb-4 rounded-xl border px-4 py-3 text-sm leading-snug ${
                    status.type === 'error' ? 'border-rose-400/30 bg-rose-500/10 text-rose-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
                    {status.message}
                  </p>
                )}

                <button type="submit" disabled={loading}
                  className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-violet-900/40 ring-1 ring-inset ring-white/20 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70">
                  {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                  {loading ? 'Submitting' : 'Register'}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
