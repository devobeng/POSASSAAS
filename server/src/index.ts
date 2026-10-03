import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { logger } from './utils/logger';
import { startExpenseCron } from './modules/expenses/expenses.cron';
import { startSubscriptionCron } from './modules/payments/subscription.cron';

// rate-limit-redis's RedisStore constructor fires off Lua-script-loading
// promises it never attaches a .catch() to — when Redis is configured but
// unreachable, those reject as soon as the connection attempt fails, with
// nothing in that library to catch them. Every other Redis-touching path in
// this app already fails open to an in-process fallback (see cache.ts,
// config/redis.ts) specifically so a Redis outage degrades the app instead
// of taking it down; letting this one specific, externally-caused rejection
// crash the whole process would defeat that. Logged loudly, not swallowed
// silently, so it's still visible — just not fatal.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

async function bootstrap() {
  await prisma.$connect();
  logger.info('Database connected');

  startExpenseCron();
  startSubscriptionCron();

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
