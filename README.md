# Sci-Mat – Open Sourcery: Registration with UPI QR + required screenshot

React + Vite + Tailwind front end, Express API (`server/index.js`), Supabase Postgres + Storage. No payment gateway.

```
Person pays Rs 50 by scanning the QR ─▶ uploads the screenshot ─▶ POST /api/register
  server validates, checks the file is a real image, stores it in a private bucket, saves the row as "pending"
You check the screenshot against your UPI history ─▶ set status to "paid" in Supabase
```

## Setup
1. Supabase SQL Editor: run `supabase/schema.sql` (safe to re-run; adds `status`, `proof_path` and the private `registration-screenshotss` bucket).
2. Copy `.env.example` to `.env`. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project. Keep the service-role/secret key only in the server `.env`—never put it in React code or a `VITE_` variable. Set `ADMIN_TOKEN` to a long random string and configure your real `VITE_UPI_ID` and `VITE_UPI_NAME`.
3. Run `npm install`, then `npm run dev`, and open http://localhost:5173.


## Reviewing and exporting
- **Table Editor** > `registrations`: each row has `status` (`pending`). Click the cell and change it to `paid` once you've verified the payment. Use the Export button there to download CSV.
- **Screenshots**: Storage > `registration-screenshotss` bucket (file name starts with the student ID).
- **One CSV with clickable screenshot links** (links expire after 1 hour):
  `curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3001/api/admin/registrations?format=csv" -o registrations.csv`
  Add `&status=pending` to see only unverified ones.

## Production
`npm run build && npm start` serves the site and API on one port. Set the same env vars on the host (plus `TRUST_PROXY=1`). Note `VITE_` values are read at build time, so rebuild after changing them.

## Limits to know
- Nothing proves a screenshot is real; always match it with your UPI/bank history (the payment note carries the student ID).
- Screenshots contain personal details; keep the bucket private and the admin token secret.
