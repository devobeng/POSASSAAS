import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { logger } from './utils/logger';
import { startExpenseCron } from './modules/expenses/expenses.cron';

async function bootstrap() {
  await prisma.$connect();
  logger.info('Database connected');

  startExpenseCron();

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
