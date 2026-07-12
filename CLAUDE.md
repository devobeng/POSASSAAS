# Claude Code Prompts — Multi-Tenant POS SaaS

Work through these in order. Each prompt builds on the last. Start every session by letting Claude Code read your `CLAUDE.md` for context.

---
Add the rule to CLAUDE.md: "Never run prisma db push or edit applied migrations. Schema changes only via prisma migrate dev --name <name>."

## Phase 0 — Project Context (run this first)

```
Create a CLAUDE.md file at the root of this project with the following context, so you always understand the architecture:

PROJECT: Multi-tenant POS SaaS platform.

TENANCY MODEL: Shared database, shared schema. Every tenant-scoped table has a storeId column. All queries MUST be scoped by storeId — never allow cross-tenant data leaks.

ROLES (hierarchical):
- SUPER_ADMIN: platform owner. Manages all stores, subscription plans, platform analytics.
- STORE_ADMIN: tenant owner. Manages their store, branches, users, inventory, reports.
- BRANCH_MANAGER: manages one branch — inventory, cashiers, branch reports.
- CASHIER: operates the POS terminal for one branch — creates orders, takes payments.

STACK:
- Backend: Node.js + Express + PostgreSQL + Prisma ORM
- Auth: JWT (access + refresh tokens), RBAC middleware
- Payments: Paystack
- Uploads: Cloudinary
- Cache: Redis (optional)
- Frontend: Next.js + React Query (server state) + Zustand (client state) + Tailwind

CONVENTIONS:
- Backend in /server, frontend in /client (monorepo)
- REST API, versioned under /api/v1
- All money stored as integers in the smallest currency unit (pesewas/kobo)
- Every controller wrapped in async error handler; centralized error middleware
- Validation with Zod on all request bodies
- Never trust storeId or branchId from the request body — always derive from the authenticated user's JWT/session
```

---

## Phase 1 — Scaffold + Database Schema

```
Scaffold the monorepo:

1. /server: Node.js + Express + TypeScript project with Prisma, dotenv, zod, bcrypt, jsonwebtoken, cors, helmet, morgan. Include tsconfig, eslint, prettier, nodemon dev script, and a src structure: /config, /middleware, /modules (feature folders), /utils, /prisma.
2. /client: Next.js 14 (App Router) + TypeScript + Tailwind + @tanstack/react-query + zustand + axios.
3. Root package.json with workspaces and scripts to run both.
4. .env.example files for both with all required variables (DATABASE_URL, JWT secrets, PAYSTACK_SECRET_KEY, CLOUDINARY creds, REDIS_URL).

Then design the complete Prisma schema for the POS SaaS:

- User (id, email, password, name, role enum [SUPER_ADMIN, STORE_ADMIN, BRANCH_MANAGER, CASHIER], storeId?, branchId?, isActive, timestamps)
- Store (tenant: id, name, slug, logoUrl, currency, subscriptionPlan, subscriptionStatus, paystackCustomerCode?, timestamps)
- Branch (id, storeId, name, address, phone, isActive)
- Category (id, storeId, name)
- Product (id, storeId, categoryId, name, sku, barcode?, imageUrl?, costPrice, sellingPrice, taxRate, isActive)
- InventoryItem (productId + branchId unique, quantity, lowStockThreshold) — stock is tracked PER BRANCH
- StockMovement (id, inventoryItemId, type enum [PURCHASE, SALE, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, RETURN], quantity, note, userId, createdAt)
- Order (id, orderNumber, storeId, branchId, cashierId, status enum [PENDING, COMPLETED, CANCELLED, REFUNDED], subtotal, taxTotal, discountTotal, grandTotal, timestamps)
- OrderItem (id, orderId, productId, productName snapshot, unitPrice snapshot, quantity, lineTotal)
- Payment (id, orderId, method enum [CASH, CARD, MOBILE_MONEY, PAYSTACK], amount, paystackReference?, status enum [PENDING, SUCCESS, FAILED, REFUNDED], timestamps)
- SubscriptionPlan (id, name, price, maxBranches, maxUsers, features json)
- AuditLog (id, storeId?, userId, action, entity, entityId, metadata json, createdAt)

Add proper indexes (storeId on every tenant table, composite indexes for common queries), relations, and onDelete behavior. Then run the migration and create a seed script with: one super admin, one demo store with 2 branches, sample categories/products with per-branch inventory, and one user of each role.
```

---

## Phase 2 — Auth + RBAC

```
Build the complete auth module in /server/src/modules/auth:

1. POST /api/v1/auth/register-store — public signup that creates a Store + its STORE_ADMIN user in one transaction. Generate a unique store slug.
2. POST /api/v1/auth/login — returns access token (15m) + refresh token (7d, httpOnly cookie). Payload includes userId, role, storeId, branchId.
3. POST /api/v1/auth/refresh — rotates refresh token.
4. POST /api/v1/auth/logout — invalidates refresh token.
5. GET /api/v1/auth/me — current user profile.

Middleware:
- authenticate: verifies JWT, attaches req.user
- authorize(...roles): role check
- tenantScope: injects req.user.storeId into a request context so services can never query cross-tenant. SUPER_ADMIN bypasses tenant scope.
- branchScope: BRANCH_MANAGER and CASHIER can only access their own branchId.

Security requirements: bcrypt with 12 rounds, rate limiting on auth routes, account lockout after 5 failed attempts, Zod validation on all inputs, generic error messages on login failure. Write integration tests for login, token refresh, and role-based access denial (e.g., a CASHIER hitting a STORE_ADMIN route must get 403).
```

---

## Phase 3 — Store, Branch & User Management

```
Build the store, branch, and user management modules:

STORE (STORE_ADMIN, own store only):
- GET/PATCH /api/v1/store — view and update store profile
- POST /api/v1/store/logo — upload logo via Cloudinary (multer memory storage → cloudinary upload stream), store secure URL

BRANCHES (STORE_ADMIN):
- Full CRUD at /api/v1/branches
- Enforce the store's subscriptionPlan.maxBranches limit on create
- Soft-delete via isActive

USERS (STORE_ADMIN creates BRANCH_MANAGER/CASHIER; BRANCH_MANAGER creates CASHIER for own branch only):
- Full CRUD at /api/v1/users
- Enforce maxUsers plan limit
- A user creating another user can never assign a role equal to or higher than their own
- Temporary password flow: created users must change password on first login

SUPER ADMIN (platform-level, /api/v1/admin):
- List/search all stores, suspend/activate a store, view platform stats (total stores, active subscriptions, GMV)
- CRUD for SubscriptionPlan

Log every mutation to AuditLog. Add integration tests for the permission edge cases.
```

---

## Phase 4 — Inventory

```
Build the inventory module:

CATEGORIES: CRUD at /api/v1/categories (STORE_ADMIN, BRANCH_MANAGER read-only).

PRODUCTS: CRUD at /api/v1/products (STORE_ADMIN):
- Image upload via Cloudinary
- SKU auto-generation if not provided; barcode field for scanner support
- Paginated list with search (name/sku/barcode), category filter, and sorting
- Bulk import from CSV (validate rows, return per-row errors)

PER-BRANCH STOCK at /api/v1/inventory:
- GET inventory for a branch (with product details, low-stock flag)
- POST /adjust — manual stock adjustment (requires note), creates StockMovement
- POST /transfer — move stock between two branches of the same store, atomic transaction, creates TRANSFER_OUT + TRANSFER_IN movements
- GET /movements — paginated stock movement history with filters
- GET /low-stock — items at or below threshold

Rules: BRANCH_MANAGER can only touch their own branch. All stock changes go through StockMovement — never update quantity directly without a movement record. Use Prisma transactions with row-level safety (updateMany with quantity guards) to prevent negative stock under concurrency. Write a test that fires concurrent stock deductions and asserts stock never goes negative.
```

---

## Phase 5 — Orders (POS Terminal API)

```
Build the orders module — the heart of the POS:

POST /api/v1/orders (CASHIER, own branch):
- Body: items [{productId, quantity}], discount?, payments [{method, amount}]
- In ONE Prisma transaction: validate stock per branch, snapshot product name + price into OrderItems, compute subtotal/tax/discount/grandTotal server-side (never trust client totals), decrement inventory with quantity guards, create SALE StockMovements, create Payment records, generate a sequential per-branch orderNumber (e.g. BR1-000123)
- Support split payments (cash + card in one order); validate payments sum to grandTotal
- If any step fails, everything rolls back

Other endpoints:
- GET /api/v1/orders — paginated, filters: branch, cashier, status, date range. CASHIER sees own orders; BRANCH_MANAGER sees branch; STORE_ADMIN sees all.
- GET /api/v1/orders/:id — full detail with items and payments
- POST /api/v1/orders/:id/refund — BRANCH_MANAGER+ only: restock items (RETURN movements), mark REFUNDED, record refund payment
- GET /api/v1/orders/:id/receipt — receipt payload (store info, branch, cashier, items, totals, payment breakdown)

Add an idempotency-key header on order creation so a double-tapped "Charge" button can't create duplicate orders. Test: order creation with insufficient stock fails cleanly, split payment mismatch is rejected, refund restores stock.
```

---

## Phase 6 — Payments (Paystack)

```
Integrate Paystack in a payments module:

1. IN-STORE DIGITAL PAYMENTS:
- POST /api/v1/payments/initialize — for an order paid via PAYSTACK: initialize a transaction (amount in kobo/pesewas, metadata: orderId, storeId, branchId), return authorization_url/access_code
- POST /api/v1/payments/webhook — Paystack webhook: verify x-paystack-signature with HMAC SHA512, handle charge.success → mark Payment SUCCESS and Order COMPLETED. Must be idempotent (same event delivered twice = no double processing). Respond 200 immediately, process async.
- GET /api/v1/payments/verify/:reference — manual verification fallback

2. SAAS SUBSCRIPTION BILLING (platform revenue):
- Stores subscribe to a SubscriptionPlan via Paystack Plans + Subscriptions API
- Handle subscription webhooks (subscription.create, invoice.payment_failed, subscription.disable) → update store.subscriptionStatus
- Middleware: if a store's subscription is PAST_DUE or CANCELLED, block write operations (allow read-only) and return a clear error code the frontend can act on

Keep all Paystack calls in a service layer (services/paystack.service.ts) so the provider is swappable. Never store card data. Log all webhook events to AuditLog.
```

---

## Phase 7 — Reports

```
Build the reports module at /api/v1/reports (role-scoped: cashier=self, manager=branch, admin=store, super admin=platform):

- GET /sales-summary — totals (revenue, orders, avg order value, tax, discounts) for a date range, grouped by day/week/month
- GET /sales-by-product — top products by revenue and quantity
- GET /sales-by-category
- GET /sales-by-cashier — performance per cashier
- GET /sales-by-branch — branch comparison (STORE_ADMIN)
- GET /payment-methods-breakdown
- GET /inventory-valuation — current stock value at cost and at selling price
- GET /profit — revenue minus COGS using costPrice snapshots
- GET /dashboard — one endpoint returning today's KPIs for the dashboard (today's sales, order count, low stock count, top 5 products)

Use raw SQL or Prisma groupBy for aggregations — no loading all rows into memory. Cache dashboard responses in Redis for 60s keyed by storeId+branchId if REDIS_URL is set (graceful fallback if not). Add CSV export (?format=csv) on every report.
```

---

## Phase 8 — Frontend (Next.js)

Break this into separate Claude Code sessions — one per prompt.

### 8a — Foundation

```
Set up the Next.js client foundation:

- Axios instance with baseURL, auth interceptor (attach access token, auto-refresh on 401 with request queueing, redirect to /login on refresh failure)
- Zustand stores: authStore (user, tokens, login/logout), uiStore (sidebar, modals, toasts), cartStore (POS cart: items, discounts, add/remove/clear, computed totals)
- React Query setup with sensible defaults and a typed API hooks layer per module (useProducts, useOrders, useCreateOrder, etc.)
- Route groups: (auth) for login/register, (dashboard) for the app — with middleware-based route protection and role-based menu rendering
- App shell: responsive sidebar + topbar, dark mode, toast system
- Login page and store registration (signup) page wired to the API
```

### 8b — POS Terminal

```
Build the POS terminal page at /pos — optimized for speed and touch:

- Left: product grid with category tabs, search box that also accepts barcode scanner input (scanners type + Enter — on Enter, match barcode and add to cart instantly), product cards with image/name/price and stock badge
- Right: cart panel — line items with quantity steppers, per-line remove, discount input (percent or fixed), live subtotal/tax/total
- Charge flow: payment modal supporting CASH (tendered amount + change calculation), CARD, MOBILE_MONEY, PAYSTACK (redirect/popup to authorization_url then poll verify), and split payments
- On success: receipt view with print stylesheet (@media print, 80mm thermal width) and "New Sale" reset
- Keyboard shortcuts: F2 focus search, F9 charge, Esc clear cart
- Everything through React Query mutations with optimistic UI where safe; send the idempotency key on charge
```

### 8c — Management Screens

```
Build the management pages (role-gated):

- /dashboard — KPI cards + charts (recharts): sales trend, top products, payment breakdown; branch selector for STORE_ADMIN
- /products — data table (search, filters, pagination), create/edit drawer with Cloudinary image upload, CSV import dialog
- /inventory — per-branch stock table with low-stock highlighting, adjust-stock modal, transfer-stock wizard, movements history
- /orders — orders table with filters, order detail drawer with receipt reprint and refund action (manager+)
- /branches, /users — CRUD tables respecting role rules (who can create whom)
- /reports — report picker with date range, charts + tables, CSV export button
- /settings — store profile, logo upload, subscription page showing current plan + upgrade via Paystack
- /admin — SUPER_ADMIN only: stores table with suspend/activate, plans CRUD, platform stats

Reuse one generic DataTable component. Every page: loading skeletons, empty states, error states.
```

---

## Phase 9 — Hardening & Deploy

```
Production-harden the app:

1. Add helmet, CORS allowlist, rate limiting (stricter on auth), request size limits, and a global error handler that never leaks stack traces in production
2. Structured logging with pino, request IDs
3. Health check endpoint (/healthz) checking DB + Redis
4. Write a test suite summary: run all integration tests, fix failures
5. Dockerize: Dockerfile for server (multi-stage), Dockerfile for client, docker-compose with Postgres + Redis for local dev
6. Write deployment docs in DEPLOY.md: env vars, prisma migrate deploy strategy, Paystack webhook URL setup, and recommended hosting (e.g., server on Railway/Render/Fly, client on Vercel, managed Postgres)
7. Do a security pass: verify every route is authenticated, every query is tenant-scoped, and write a test that user from Store A can NEVER read Store B's data through any endpoint
```

---

## Tips for using these with Claude Code

1. **One phase per session.** Finish, review, commit, then start the next prompt.
2. **Always commit before a new phase** so you can roll back cleanly.
3. **Ask it to run the tests** after each phase: "Run the test suite and fix any failures before finishing."
4. **When something breaks**, paste the exact error and say "fix this without changing unrelated code."
5. **Guard the tenancy rule.** Periodically prompt: "Audit all Prisma queries and confirm every tenant-scoped query filters by storeId derived from the JWT, not the request body."
