import cron from 'node-cron';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

/**
 * Materialises due recurring expenses as new PENDING records.
 * Called on boot (catch-up for missed days) and daily at midnight.
 */
export async function materializeRecurringExpenses(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // All recurring templates whose nextDueDate is today or in the past
  const due = await prisma.expense.findMany({
    where: {
      isRecurring: true,
      nextDueDate: { lte: today },
      // Only materialise from APPROVED templates; PENDING/REJECTED templates are ignored
      status: 'APPROVED',
    },
  });

  if (due.length === 0) return;

  logger.info(`[expenses-cron] Materialising ${due.length} recurring expense(s)`);

  for (const template of due) {
    // Walk nextDueDate forward until it is in the future, creating a record for each missed period
    let dueDate = template.nextDueDate!;

    while (dueDate <= today) {
      await prisma.expense.create({
        data: {
          storeId:           template.storeId,
          branchId:          template.branchId,
          categoryId:        template.categoryId,
          amount:            template.amount,
          description:       template.description,
          expenseDate:       dueDate,
          isRecurring:       false,   // materialised copy is not itself a recurring template
          recordedById:      template.recordedById,
          status:            'PENDING',
        },
      });

      // Advance by interval
      const next = new Date(dueDate);
      if (template.recurringInterval === 'WEEKLY') {
        next.setDate(next.getDate() + 7);
      } else {
        next.setMonth(next.getMonth() + 1);
      }
      dueDate = next;
    }

    // Update the template's nextDueDate to the next future date
    await prisma.expense.update({
      where: { id: template.id },
      data: { nextDueDate: dueDate },
    });
  }

  logger.info('[expenses-cron] Done');
}

/** Register cron schedule and run catch-up immediately on boot. */
export function startExpenseCron(): void {
  // Catch-up: run once immediately so missed intervals from downtime are filled
  materializeRecurringExpenses().catch((err) =>
    logger.error('[expenses-cron] Catch-up failed', err),
  );

  // Daily at 00:05 — slightly offset so the DB isn't hit at exact midnight
  cron.schedule('5 0 * * *', () => {
    materializeRecurringExpenses().catch((err) =>
      logger.error('[expenses-cron] Scheduled run failed', err),
    );
  });

  logger.info('[expenses-cron] Scheduled (daily 00:05 + boot catch-up)');
}
