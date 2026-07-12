# Deployment Guide

## Architecture

```
Vercel (Next.js client)  ←→  Render (Express API)  ←→  Supabase (PostgreSQL)
                                                    ←→  Cloudinary (images)
                                                    ←→  Paystack (payments)
```

---

## 1. Database — Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. In **Settings → Database**, copy the **Connection string** (URI format, Transaction Pooler recommended for serverless).
3. Add `?pgbouncer=true&connection_limit=1` to the URL when using PgBouncer.

```
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

### Run migrations on first deploy

```bash
cd server
npx prisma migrate deploy   # applies all pending migrations
npx ts-node prisma/seed.ts  # optional: seed demo data
```

> **Never** run `prisma migrate dev` against production — always use `migrate deploy`.

---

## 2. API Server — Render

1. Create a new **Web Service** on [render.com](https://render.com).
2. Connect your GitHub repo.
3. Configure:
   - **Root directory**: `server`
   - **Build command**: `npm ci && npm run build && npx prisma generate`
   - **Start command**: `npx prisma migrate deploy && node dist/index.js`
   - **Environment**: Node 20

### Required environment variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `5000` (Render sets this automatically) |
| `DATABASE_URL` | Supabase connection string |
| `JWT_ACCESS_SECRET` | Random string ≥ 32 chars |
| `JWT_REFRESH_SECRET` | Different random string ≥ 32 chars |
| `CLIENT_URL` | Your Vercel deployment URL (e.g. `https://mypos.vercel.app`) |
| `PAYSTACK_SECRET_KEY` | From Paystack dashboard |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |

**Optional:**

| Variable | Description |
|---|---|
| `REDIS_URL` | Redis connection string (e.g. Upstash) — in-memory cache used if unset |
| `LOG_LEVEL` | `info` (default), `debug`, `warn`, `error` |

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Health check

Render will ping `/healthz` to confirm the service is up. The endpoint checks the DB connection and returns:

```json
{ "status": "ok", "db": "ok", "timestamp": "..." }
```

---

## 3. Client — Vercel

1. Import your repo on [vercel.com](https://vercel.com).
2. Set **Root directory** to `client`.
3. Vercel auto-detects Next.js — no build command changes needed.

### Required environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Your Render API URL (e.g. `https://pos-api.onrender.com/api/v1`) |

> `NEXT_PUBLIC_` prefix is required for Next.js to expose the variable to the browser bundle.

---

## 4. Paystack webhook

After deploying the server:

1. Go to Paystack Dashboard → **Settings → Webhooks**.
2. Add your webhook URL:
   ```
   https://pos-api.onrender.com/api/v1/payments/webhook
   ```
3. Copy the **Webhook Secret** (shown on the Paystack dashboard) — it is used in the HMAC SHA-512 signature verification. The server reads it from the `PAYSTACK_SECRET_KEY` env var (same key used for API calls).

> The webhook endpoint is idempotent — duplicate events are safely ignored.

---

## 5. Local development with Docker

```bash
# Start Postgres + Redis
docker-compose up db redis -d

# Server
cd server
cp .env.example .env   # fill in values
npm install
npm run db:migrate
npm run db:seed
npm run dev

# Client (separate terminal)
cd client
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
npm install
npm run dev
```

Or run everything in containers:

```bash
docker-compose up --build
```

---

## 6. Continuous deployment

Both Render and Vercel auto-deploy on push to `main`. The recommended workflow:

1. Develop on a feature branch.
2. Open a PR → run `npm test` in CI (GitHub Actions or similar).
3. Merge to `main` → Render and Vercel pick it up automatically.
4. Render runs `prisma migrate deploy` as part of the start command, so schema changes deploy atomically with the new code.

---

## 7. Security checklist before going live

- [ ] All `JWT_*_SECRET` values are random and ≥ 32 characters
- [ ] `CLIENT_URL` is set to your exact Vercel domain (no trailing slash)
- [ ] Paystack secret key is the **live** key, not test
- [ ] Supabase Row Level Security (RLS) is **disabled** — tenancy is enforced at the application layer via `storeId` on every query
- [ ] Cloudinary upload preset is restricted to your server's IP or signed uploads only
- [ ] Rate limits are in place (auth: 10 req/15min, global API: 300 req/min)
- [ ] `NODE_ENV=production` so stack traces are never sent to clients
