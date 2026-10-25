import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate, toRow } from '../shared/validate.js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN, PORT = 3001, TRUST_PROXY } = process.env
const BUCKET = 'payment-proofs' // private bucket, created by supabase/schema.sql
const MAX_PROOF = 2 * 1024 * 1024
const real = (v) => Boolean(v) && !/^(your|PASTE)/i.test(v) && !v.includes('your-project-ref')
const configured = real(SUPABASE_URL) && real(SUPABASE_SERVICE_ROLE_KEY)
console.log('[Supabase config check]', {
  urlPresent: Boolean(SUPABASE_URL),
  keyPresent: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  urlAccepted: real(SUPABASE_URL),
  keyAccepted: real(SUPABASE_SERVICE_ROLE_KEY)
})
const db = configured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) }
const fail = (res, status, message, extra = {}) => res.status(status).json({ ok: false, message, ...extra })

// Reads a data-URL screenshot and checks the real file signature (the browser-supplied type is not trusted).
function parseProof(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '')
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length < 100 || buf.length > MAX_PROOF) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return { buf, ext: 'jpg', type: 'image/jpeg' }
  if (buf.subarray(0, 4).toString('hex') === '89504e47') return { buf, ext: 'png', type: 'image/png' }
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { buf, ext: 'webp', type: 'image/webp' }
  return null
}

const app = express()
app.disable('x-powered-by')
if (TRUST_PROXY) app.set('trust proxy', Number(TRUST_PROXY) || TRUST_PROXY)
app.use((_, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next() })
app.use(express.json({ limit: '3mb' })) // screenshot is compressed in the browser and sent as base64

const limiter = (max) => rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Wait a minute and try again.' } })

app.get('/api/health', (_, res) => res.json({ ok: true, configured }))

// ---- Public: receive a registration + payment screenshot -----------------
app.post('/api/register', limiter(10), async (req, res) => {
  if (!configured) return fail(res, 503, 'Database is not configured. Nothing was saved.', { code: 'not_configured' })
  const errors = validate(req.body)
  const proof = parseProof(req.body?.proof)
  if (!proof) errors.proof = 'Upload the required screenshot (JPG, PNG or WebP, up to 2 MB).'
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors })

  const row = toRow(req.body)
  const { data: existing, error: e0 } = await db.from('registrations').select('id').eq('student_id', row.student_id).limit(1)
  if (e0) { console.error('[register] lookup:', e0.message); return fail(res, 500, 'Server error. Try again shortly.') }
  if (existing?.length) return fail(res, 409, 'This student ID is already registered.', { code: 'duplicate' })

  const proof_path = `${row.student_id}-${Date.now()}.${proof.ext}`
  const { error: e1 } = await db.storage.from(BUCKET).upload(proof_path, proof.buf, { contentType: proof.type, upsert: false })
  if (e1) { console.error('[register] upload:', e1.message); return fail(res, 500, 'Could not save your screenshot. Try again.') }

  const { error: e2 } = await db.from('registrations').insert({ ...row, proof_path, status: 'pending' })
  if (e2) {
    await db.storage.from(BUCKET).remove([proof_path]) // don't leave an orphaned file
    if (e2.code === '23505') return fail(res, 409, 'This student ID is already registered.', { code: 'duplicate' })
    console.error('[register] insert:', e2.message)
    return fail(res, 500, 'Could not save your registration. Try again shortly.')
  }
  res.status(201).json({ ok: true, registration: row })
})

// ---- Admin: list registrations with 1-hour screenshot links (Bearer ADMIN_TOKEN) ----
const csvCell = (v) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` }
app.get('/api/admin/registrations', limiter(30), async (req, res) => {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16) return fail(res, 404, 'Admin access is disabled.')
  if (!safeEqual((req.get('authorization') || '').replace(/^Bearer\s+/i, ''), ADMIN_TOKEN)) return fail(res, 401, 'Unauthorized.')
  if (!configured) return fail(res, 503, 'Not configured.')

  let q = db.from('registrations').select('full_name,batch,student_id,status,proof_path,created_at').order('created_at', { ascending: false })
  if (['paid', 'pending'].includes(req.query.status)) q = q.eq('status', req.query.status)
  const { data, error } = await q
  if (error) { console.error('[admin]', error.message); return fail(res, 500, 'Could not read registrations.') }

  const paths = data.map((r) => r.proof_path).filter(Boolean)
  const urls = {}
  if (paths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.signedUrl) urls[s.path] = s.signedUrl
  }
  const rows = data.map(({ proof_path, ...r }) => ({ ...r, screenshot_url: urls[proof_path] ?? '' }))

  if (req.query.format === 'csv') {
    const cols = ['full_name', 'batch', 'student_id', 'status', 'screenshot_url', 'created_at']
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="registrations.csv"')
      .send([cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'))
  } else res.json({ ok: true, count: rows.length, registrations: rows })
})

app.use('/api', (_, res) => fail(res, 404, 'Not found.'))

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.use((req, res) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : res.status(404).end()))
}

app.use((err, _req, res, _next) => {
  const status = err.status && err.status < 500 ? err.status : 500
  if (status === 500) console.error(err.message)
  fail(res, status, status === 413 ? 'Screenshot is too large. Choose a smaller image and try again.' : err?.type === 'entity.parse.failed' ? 'Request data was invalid. Please try again.' : status === 500 ? 'Server error. Try again shortly.' : 'Invalid request.')
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
  if (!configured) console.warn('Supabase env vars missing: DEMO mode (nothing is saved).')
})
