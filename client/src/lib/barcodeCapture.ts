// Global barcode capture — timing-based scanner detection
// A barcode scanner fires keystrokes very fast (< 30ms inter-key interval).
// Human typing is much slower (typically > 100ms).
// This module registers a capture-phase keydown listener and emits 'scan' events
// when the timing pattern matches a scanner.  It works even when the search input
// is not focused, so the POS never misses a scan.

export type ScanHandler = (barcode: string) => void;

interface CaptureOptions {
  // Maximum inter-key interval to consider "from a scanner" (ms)
  maxInterKeyMs?: number;
  // Minimum barcode length to emit (filters stray key presses)
  minLength?: number;
  // Clear buffer after this many ms of inactivity
  idleTimeoutMs?: number;
}

export class GlobalBarcodeCapture {
  private buffer  = '';
  private lastTs  = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handlers: ScanHandler[] = [];
  private readonly maxInterKeyMs: number;
  private readonly minLength: number;
  private readonly idleTimeoutMs: number;
  private active = false;

  constructor(opts: CaptureOptions = {}) {
    this.maxInterKeyMs = opts.maxInterKeyMs ?? 30;
    this.minLength     = opts.minLength     ?? 4;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 500;
  }

  on(handler: ScanHandler)  { this.handlers.push(handler); }
  off(handler: ScanHandler) { this.handlers = this.handlers.filter((h) => h !== handler); }

  private emit(barcode: string) {
    for (const h of this.handlers) h(barcode);
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    // Ignore modifier-only keys and control keys except Enter
    if (e.key.length > 1 && e.key !== 'Enter') return;
    // Ignore events from non-printable keys
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const now = Date.now();

    if (e.key === 'Enter') {
      const barcode = this.buffer.trim();
      if (barcode.length >= this.minLength) {
        // Only suppress the Enter if it looks like a scan (the buffer filled rapidly)
        // If the active element is an input and the buffer is SHORT, it might be
        // the user pressing Enter to search — don't hijack it.
        const elapsed = now - this.lastTs;
        if (elapsed < this.idleTimeoutMs) {
          e.stopPropagation();
          e.preventDefault();
          this.emit(barcode);
        }
      }
      this.reset();
      return;
    }

    const elapsed = now - this.lastTs;
    this.lastTs = now;

    // Reset buffer if too slow (human typing)
    if (elapsed > this.maxInterKeyMs && this.buffer.length > 0) {
      this.reset();
    }

    this.buffer += e.key;

    // Idle reset
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reset(), this.idleTimeoutMs);
  };

  private reset() {
    this.buffer = '';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    // capture phase so we see the event before inputs do
    document.addEventListener('keydown', this.handleKeydown, true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('keydown', this.handleKeydown, true);
    this.reset();
  }
}

// ─── Weighted barcode parser (EAN-13 starting with '2') ──────────────────────
// Common in-store format: 2PPPPPVVVVVC
// PPPPP = product code (5 digits), VVVVV = value (5 digits), C = check digit
// Type 'price': VVVVV = price in cents (e.g. 01500 = 15.00)
// Type 'weight': VVVVV = weight in grams  (e.g. 01500 = 1500g = 1.5kg)

export interface WeightedBarcodeResult {
  productCode: string;  // 5-digit code to look up in catalog
  value: number;        // parsed numeric value (cents or grams)
  type: 'price' | 'weight';
  rawBarcode: string;
}

export function parseWeightedBarcode(
  barcode: string,
  type: 'price' | 'weight' = 'price',
): WeightedBarcodeResult | null {
  if (barcode.length !== 13 || !barcode.startsWith('2')) return null;
  if (!/^\d{13}$/.test(barcode)) return null;

  // Verify EAN-13 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(barcode[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== parseInt(barcode[12], 10)) return null;

  const productCode = barcode.slice(1, 6);
  const valueStr    = barcode.slice(6, 11);
  const value       = parseInt(valueStr, 10);

  return { productCode, value, type, rawBarcode: barcode };
}

// ─── Scan beep (WebAudio) ─────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

export function playScanBeep(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(1800, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.12);
  } catch { /* non-fatal */ }
}
