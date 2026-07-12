# POS SaaS — Point of Sale Platform

A multi-tenant SaaS POS system built for African retail businesses. Each merchant gets their own isolated store with branches, inventory, cashiers, and reporting — all on a shared database with strict per-store data isolation.

---

## Features

### For store owners (STORE_ADMIN)
- **Multi-branch management** — create and manage unlimited branches (up to your plan limit)
- **Product catalogue** — create products with images (Cloudinary), SKU, barcode, cost/selling price, tax rate, and categories
- **CSV import** — bulk-import products from a spreadsheet
- **User management** — invite branch managers and cashiers; role-based access prevents over-privileged accounts
- **Store-wide reports** — sales by product, category, cashier, branch; payment method breakdown; inventory valuation; gross profit
- **Subscription management** — upgrade plan via Paystack

### For branch managers (BRANCH_MANAGER)
- **Branch inventory** — view stock levels, adjust stock (with audit note), transfer stock between branches
- **Orders** — view all orders for their branch; refund completed orders (restocks items automatically)
- **Branch reports** — same reports scoped to their branch

### For cashiers (CASHIER)
- **POS terminal** — fast touch-optimised interface with:
  - Category tabs and live product search
  - **Barcode scanner support** — plug in a USB scanner, scan a barcode → product added instantly
  - Cart with quantity adjustments and discount input (fixed amount or percentage)
  - Split payments across multiple methods (Cash + Card, etc.)
  - Payment methods: Cash, Card, Mobile Money, Paystack (redirect/QR)
  - Change calculation for cash payments
  - **Thermal receipt** — prints to 80mm receipt printers via browser print dialog
  - Keyboard shortcuts: `F2` focus search, `F9` charge, `Esc` clear

### Platform features
- **Idempotent order creation** — double-tapping Charge never creates duplicate orders
- **Atomic stock decrement** — concurrent orders can never oversell; stock never goes negative
- **Full audit log** — every mutation is recorded with user, timestamp, and metadata
- **Dark mode** — full dark/light theme with system preference detection (no flash on load)

### For platform admins (SUPER_ADMIN)
- View all stores, subscription statuses, GMV
- Suspend/activate stores
- Manage subscription plans (create, delete)

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Supabase) |
| Auth | JWT (access token 15m + httpOnly refresh cookie 7d) |
| Payments | Paystack |
| Image uploads | Cloudinary |
| Frontend | Next.js 14 (App Router) + TypeScript |
| UI | Tailwind CSS |
| Server state | TanStack Query (React Query v5) |
| Client state | Zustand |
| Charts | Recharts |

---

## Role hierarchy

```
SUPER_ADMIN
  └─ STORE_ADMIN      (one per store — created on registration)
       └─ BRANCH_MANAGER  (created by STORE_ADMIN, assigned to one branch)
            └─ CASHIER     (created by STORE_ADMIN or BRANCH_MANAGER)
```

A user can only create accounts with a role strictly below their own.

---

## Getting started (local)

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ (or Docker)

### 1. Clone and install

```bash
git clone <repo-url>
cd POS
npm install          # installs both workspaces
```

### 2. Set up environment variables

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env.local
```

Edit `server/.env`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/pos_dev
JWT_ACCESS_SECRET=<random 48-char string>
JWT_REFRESH_SECRET=<different random 48-char string>
CLIENT_URL=http://localhost:3000
PAYSTACK_SECRET_KEY=sk_test_xxx        # optional for local dev
CLOUDINARY_CLOUD_NAME=xxx              # optional for local dev
CLOUDINARY_API_KEY=xxx
CLOUDINARY_API_SECRET=xxx
```

Edit `client/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
```

### 3. Set up the database

```bash
cd server
npm run db:migrate   # run Prisma migrations
npm run db:seed      # seed demo data
```

The seed creates:
- 1 super admin: `super@pos.com` / `SuperAdmin@123`
- 1 demo store with 2 branches
- Sample categories and products with per-branch stock
- One user of each role (passwords in `prisma/seed.ts`)

### 4. Start development servers

```bash
# From repo root
npm run dev          # starts both server (port 5000) and client (port 3000)
```

Or individually:
```bash
cd server && npm run dev   # port 5000
cd client && npm run dev   # port 3000
```

### 5. Run tests

```bash
cd server && npm test
```

---

## API overview

All endpoints are under `/api/v1`. Auth uses Bearer tokens in the `Authorization` header.

| Module | Base path | Roles |
|---|---|---|
| Auth | `/auth` | Public (login/register), authenticated (me/logout/refresh) |
| Store | `/store` | STORE_ADMIN |
| Branches | `/branches` | STORE_ADMIN (write), BRANCH_MANAGER (read) |
| Users | `/users` | STORE_ADMIN, BRANCH_MANAGER (create CASHIER only) |
| Categories | `/categories` | STORE_ADMIN (write), all (read) |
| Products | `/products` | STORE_ADMIN (write), all (read) |
| Inventory | `/inventory` | BRANCH_MANAGER, STORE_ADMIN |
| Orders | `/orders` | CASHIER (create), BRANCH_MANAGER+ (list/refund) |
| Payments | `/payments` | CASHIER (initiate), webhook (public with HMAC) |
| Reports | `/reports` | All roles (scoped to their level) |
| Admin | `/admin` | SUPER_ADMIN only |

**Health check:** `GET /healthz` — returns `{ status: "ok", db: "ok" }`. No auth required.

---

## Project structure

```
POS/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma      # full data model
│   │   └── seed.ts            # demo data
│   └── src/
│       ├── config/            # env validation, Prisma client
│       ├── middleware/        # auth, RBAC, tenant scope, error handler
│       ├── modules/           # feature folders (auth, orders, inventory…)
│       ├── services/          # Paystack API client
│       ├── utils/             # logger, JWT, bcrypt, cache, audit log
│       └── __tests__/         # Jest integration tests
└── client/
    └── src/
        ├── app/
        │   ├── (auth)/        # login, register pages
        │   └── (dashboard)/   # all protected pages
        ├── components/
        │   ├── layout/        # Sidebar, Topbar, Toaster
        │   ├── pos/           # POS terminal components
        │   ├── products/      # ProductDrawer
        │   └── ui/            # DataTable, Drawer, Modal, Badge
        ├── hooks/api/         # typed React Query hooks per module
        ├── lib/               # Axios instance with token-refresh queueing
        └── store/             # Zustand stores (auth, ui, cart)
```

---

## Deployment

See [DEPLOY.md](DEPLOY.md) for full instructions (Render + Vercel + Supabase).

---

## Security

- All tenant-scoped queries filter by `storeId` derived from the JWT — never from the request body
- Passwords hashed with bcrypt (12 rounds)
- Refresh tokens stored as bcrypt hashes; rotated on each use
- Account lockout after 5 failed login attempts (15-minute lockout)
- Paystack webhooks verified with HMAC SHA-512
- Rate limiting: 10 login attempts / 15 min; 300 API requests / minute
- Stack traces never leak in production responses
- Request IDs on every response (`x-request-id` header) for log correlation

---

## License

MIT
