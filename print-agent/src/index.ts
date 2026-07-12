import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';

const PORT = parseInt(process.env.PORT ?? '9977', 10);
// Printer name or path — override via env: PRINTER_NAME on Windows, PRINTER_PATH on Linux/Mac
const PRINTER_NAME = process.env.PRINTER_NAME ?? '';
const PRINTER_PATH = process.env.PRINTER_PATH ?? '/dev/usb/lp0';

const app = express();

// Only accept connections from localhost — the browser page itself
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '512kb' }));

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, version: '1.0.0', printerName: PRINTER_NAME || PRINTER_PATH });
});

// ── Raw ESC/POS bytes ─────────────────────────────────────────────────────────
// Browser sends Uint8Array serialised as application/octet-stream.
// We write it directly to the OS printer without any transformation.

app.post('/print/raw', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bytes: Buffer = req.body as Buffer;
    if (!bytes || bytes.length === 0) {
      res.status(400).json({ ok: false, error: 'Empty body' });
      return;
    }
    await sendRawBytes(bytes);
    res.json({ ok: true, bytes: bytes.length });
  } catch (err) {
    next(err);
  }
});

// ── JSON receipt (rendered server-side via node-thermal-printer) ──────────────
// Accepts the ReceiptDocument shape from the browser if the caller wants
// the agent to do the ESC/POS encoding instead.

interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReceiptDocument {
  storeName: string;
  branchName?: string;
  orderNumber: string;
  cashierName: string;
  createdAt: string;
  items: ReceiptItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  grandTotal: number;
  payments: Array<{ method: string; amount: number }>;
  cashTendered?: number;
  headerText?: string;
  footerText?: string;
  currency: string;
}

app.post('/print', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = req.body as ReceiptDocument;
    if (!doc?.orderNumber) {
      res.status(400).json({ ok: false, error: 'Invalid receipt document' });
      return;
    }
    const bytes = await buildEscPos(doc);
    await sendRawBytes(bytes);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[print-agent]', err.message);
  res.status(500).json({ ok: false, error: err.message });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendRawBytes(bytes: Buffer): Promise<void> {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // On Windows use node-thermal-printer with the network/USB printer name
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_NAME ? `\\\\localhost\\${PRINTER_NAME}` : 'tcp://127.0.0.1:9100',
      characterSet: CharacterSet.PC852_LATIN2,
    });
    // node-thermal-printer doesn't have a "write raw" path, so we write
    // the prebuilt bytes by calling the internal execute with a raw buffer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (printer as any).buffer = bytes;
    await printer.execute();
    printer.clear();
  } else {
    // On Linux / macOS write directly to the device file or use lp
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { writeFile, unlink } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tmpFile = join(tmpdir(), `receipt-${Date.now()}.bin`);
    await writeFile(tmpFile, bytes);
    try {
      if (PRINTER_NAME) {
        await promisify(execFile)('lp', ['-d', PRINTER_NAME, tmpFile]);
      } else {
        // Write directly to device file (requires read/write permission)
        const { createWriteStream } = await import('fs');
        await new Promise<void>((resolve, reject) => {
          const stream = createWriteStream(PRINTER_PATH);
          stream.write(bytes, (err) => {
            if (err) reject(err); else { stream.end(); resolve(); }
          });
        });
      }
    } finally {
      await unlink(tmpFile).catch(() => undefined);
    }
  }
}

async function buildEscPos(doc: ReceiptDocument): Promise<Buffer> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'buffer',
    characterSet: CharacterSet.PC852_LATIN2,
    width: 42,
  });

  const fmt = (n: number) =>
    (n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (left: string, right: string, width = 42) => {
    const gap = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, gap)) + right;
  };

  if (doc.headerText) {
    printer.alignCenter();
    printer.println(doc.headerText);
  }

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(doc.storeName);
  printer.setTextSize(0, 0);
  printer.bold(false);
  if (doc.branchName) printer.println(doc.branchName);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Order: ${doc.orderNumber}`);
  printer.println(`Date:  ${new Date(doc.createdAt).toLocaleString()}`);
  printer.println(`Staff: ${doc.cashierName}`);
  printer.drawLine();

  for (const item of doc.items) {
    printer.println(`${item.name}`);
    printer.println(pad(`  ${item.quantity} x ${fmt(item.unitPrice)}`, fmt(item.lineTotal)));
  }

  printer.drawLine();
  printer.println(pad('Subtotal', `${doc.currency} ${fmt(doc.subtotal)}`));
  if (doc.taxTotal > 0) printer.println(pad('Tax', `${doc.currency} ${fmt(doc.taxTotal)}`));
  if (doc.discountAmount > 0) printer.println(pad('Discount', `-${doc.currency} ${fmt(doc.discountAmount)}`));
  printer.bold(true);
  printer.println(pad('TOTAL', `${doc.currency} ${fmt(doc.grandTotal)}`));
  printer.bold(false);

  printer.drawLine();
  for (const pmt of doc.payments) {
    printer.println(pad(pmt.method, `${doc.currency} ${fmt(pmt.amount)}`));
  }
  if (doc.cashTendered !== undefined) {
    printer.println(pad('Tendered', `${doc.currency} ${fmt(doc.cashTendered)}`));
    printer.println(pad('Change', `${doc.currency} ${fmt(doc.cashTendered - doc.grandTotal)}`));
  }

  printer.drawLine();
  printer.alignCenter();
  if (doc.footerText) {
    printer.println(doc.footerText);
  } else {
    printer.println('Thank you!');
  }

  printer.cut();

  return (printer as unknown as { buffer: Buffer }).buffer;
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[print-agent] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[print-agent] Printer: ${PRINTER_NAME || PRINTER_PATH || '(auto)'}`);
});
