// Single source of truth: imported by the React form AND the Express server.
export const BATCHES = ['2024', '2025', '2026']

export const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

export function validate(v = {}) {
  const e = {}
  const name = clean(v.fullName)
  const id = clean(v.studentId)
  if (!name) e.fullName = 'Enter your full name.'
  else if (name.length < 2 || name.length > 100 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(name))
    e.fullName = 'Use letters only, between 2 and 100 characters.'
  if (!BATCHES.includes(String(v.batch))) e.batch = 'Select your batch.'
  if (!id) e.studentId = 'Enter your student ID.'
  else if (!/^\d{4,10}$/.test(id)) e.studentId = 'Student ID must be 4 to 10 digits.'
  return e
}

// Database row shape (only call after validate() returns no errors).
export const toRow = (v) => ({ full_name: clean(v.fullName), batch: String(v.batch), student_id: clean(v.studentId) })
