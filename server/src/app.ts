import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { baseLogger } from './utils/logger';
import { prisma } from './config/database';
import { authRouter } from './modules/auth/auth.routes';
import { storeRouter } from './modules/store/store.routes';
import { branchesRouter } from './modules/branches/branches.routes';
import { usersRouter } from './modules/users/users.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { plansRouter } from './modules/plans/plans.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { productsRouter } from './modules/products/products.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { syncRouter } from './modules/sync/sync.routes';
import { expensesRouter } from './modules/expenses/expenses.routes';
import { errorHandler, notFound } from './middleware/error';

const app = express();

// Disable Express's default ETag generation for API responses — ETags cause
// browsers to send conditional requests (If-None-Match) which result in 304
// responses with empty bodies. axios treats 304 as an error, breaking the
// token-refresh retry flow and leaving React Query without data.
app.set('etag', false);

// Render (and Vercel/Heroku/most PaaS hosts) sit exactly one reverse-proxy
// hop in front of this app — without this, express-rate-limit and any
// req.ip-based logic see the proxy's IP for every request, collapsing all
// traffic into a single rate-limit bucket instead of limiting per real client.
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// ── Structured request logging with request IDs ───────────────────────────────
app.use(
  pinoHttp({
    logger: baseLogger,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      if (existing) { res.setHeader('x-request-id', existing); return existing as string; }
      const id = crypto.randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Skip health-check noise in logs
    autoLogging: { ignore: (req) => req.url === '/healthz' },
    // Don't log 4xx as errors — they're client mistakes
    customLogLevel: (_req, res) => {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);

// ── Global rate limiter (generous — covers all /api routes) ──────────────────
// Load-tested at 300 concurrent connections: the previous 300/min ceiling was
// exhausted within the first second, then 429'd ~99% of legitimate traffic
// for the rest of the window. Keyed per-IP, this also disproportionately
// throttles multiple stores/cashiers sharing a NAT'd office IP. 2000/min
// comfortably covers a busy multi-terminal store; a real DDoS is still
// caught well below what this allows. Longer term this should key on the
// authenticated user/store post-auth rather than raw IP — flagged as a
// follow-up, not changed here since it touches auth-middleware ordering.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — please slow down' },
});
app.use('/api', globalLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(cookieParser());
// Paystack webhook needs the raw body for HMAC verification — must come first
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() });
  }
});

// ── Prevent browser caching of all API responses ─────────────────────────────
// Combined with etag:false above this ensures browsers never store API
// responses and therefore never send conditional requests that result in
// 304 empty-body replies breaking the axios token-refresh retry loop.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/store', storeRouter);
app.use('/api/v1/branches', branchesRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/plans', plansRouter);
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/sync', syncRouter);
app.use('/api/v1/expenses', expensesRouter);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export { app };
