// ESC/POS byte encoder
// Supports: init, alignment, bold, size, text, newline, feed, cut, QR code, cash drawer kick
// Character encoding: ASCII + Latin-1 (code page 0 — safe for most receipt content)

import type { ReceiptDocument } from './types';

// ─── Command bytes ────────────────────────────────────────────────────────────

const ESC = 0x1B;
const GS  = 0x1D;
const LF  = 0x0A;

const CMD = {
  INIT:            [ESC, 0x40],
  ALIGN_LEFT:      [ESC, 0x61, 0x00],
  ALIGN_CENTER:    [ESC, 0x61, 0x01],
  ALIGN_RIGHT:     [ESC, 0x61, 0x02],
  BOLD_ON:         [ESC, 0x45, 0x01],
  BOLD_OFF:        [ESC, 0x45, 0x00],
  SIZE_NORMAL:     [GS,  0x21, 0x00],
  SIZE_DOUBLE_H:   [GS,  0x21, 0x01],   // double height
  SIZE_DOUBLE:     [GS,  0x21, 0x11],   // double height + width
  PARTIAL_CUT:     [GS,  0x56, 0x01],
  DRAWER_PIN2:     [ESC, 0x70, 0x00, 0x19, 0xFA],  // cash drawer pin 2
  DRAWER_PIN5:     [ESC, 0x70, 0x01, 0x19, 0xFA],  // cash drawer pin 5
} as const;

// ─── Encoder class ────────────────────────────────────────────────────────────

export class EscPosEncoder {
  private buf: number[] = [];

  private push(...bytes: number[]) { this.buf.push(...bytes); return this; }

  init()         { return this.push(...CMD.INIT); }
  alignLeft()    { return this.push(...CMD.ALIGN_LEFT); }
  alignCenter()  { return this.push(...CMD.ALIGN_CENTER); }
  alignRight()   { return this.push(...CMD.ALIGN_RIGHT); }
  boldOn()       { return this.push(...CMD.BOLD_ON); }
  boldOff()      { return this.push(...CMD.BOLD_OFF); }
  sizeNormal()   { return this.push(...CMD.SIZE_NORMAL); }
  sizeDoubleH()  { return this.push(...CMD.SIZE_DOUBLE_H); }
  sizeDouble()   { return this.push(...CMD.SIZE_DOUBLE); }
  newline()      { return this.push(LF); }
  partialCut()   { return this.push(...CMD.PARTIAL_CUT); }
  drawerKick()   { return this.push(...CMD.DRAWER_PIN2); }

  feed(lines = 1) { return this.push(ESC, 0x64, lines); }

  text(str: string) {
    // Encode as Latin-1 (byte-per-char); non-Latin chars become '?'
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      this.buf.push(code < 256 ? code : 0x3F);
    }
    return this;
  }

  line(str: string) { return this.text(str).newline(); }

  // Right-aligned two-column row: "label........value"
  twoCol(label: string, value: string, width: number) {
    const gap = Math.max(1, width - label.length - value.length);
    return this.line(`${label}${'.'.repeat(gap)}${value}`);
  }

  // Separator line of dashes
  divider(width: number) { return this.line('-'.repeat(width)); }

  // QR code (Model 2, size 6, error correction M)
  qrCode(data: string) {
    const bytes = Array.from(data).map((c) => c.charCodeAt(0));
    const len   = bytes.length + 3;
    const pL    = len & 0xFF;
    const pH    = (len >> 8) & 0xFF;

    // Set model 2
    this.push(GS, 0x28, 0x6B, 4, 0, 49, 65, 50, 0);
    // Set size 6
    this.push(GS, 0x28, 0x6B, 3, 0, 49, 67, 6);
    // Set error correction M
    this.push(GS, 0x28, 0x6B, 3, 0, 49, 69, 48);
    // Store data
    this.push(GS, 0x28, 0x6B, pL, pH, 49, 80, 48, ...bytes);
    // Print
    this.push(GS, 0x28, 0x6B, 6, 0, 49, 81, 48);
    return this;
  }

  toBytes(): Uint8Array { return new Uint8Array(this.buf); }
  reset()              { this.buf = []; return this; }
}

// ─── Receipt → ESC/POS bytes ──────────────────────────────────────────────────

export function encodeReceipt(doc: ReceiptDocument): Uint8Array {
  const enc  = new EscPosEncoder();
  const W    = doc.paperWidth === 58 ? 32 : 42;  // chars per line
  const fmt  = (n: number) => `${doc.currency} ${n.toFixed(2)}`;

  enc.init();

  // ── Header ─────────────────────────────────────────────────────────────────
  if (doc.headerText) {
    enc.alignCenter().line(doc.headerText);
  }

  enc.alignCenter().boldOn().sizeDoubleH().line(doc.storeName).sizeNormal().boldOff();
  enc.alignCenter().line(doc.branchName);
  if (doc.branchAddress) enc.alignCenter().line(doc.branchAddress);
  enc.feed(1);

  // ── Order meta ──────────────────────────────────────────────────────────────
  const date = new Date(doc.date).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  enc.alignLeft();
  enc.line(`Order : ${doc.orderNumber}`);
  if (doc.offlineReference && doc.offlineReference !== doc.orderNumber) {
    enc.line(`Ref   : ${doc.offlineReference}`);
  }
  enc.line(`Date  : ${date}`);
  enc.line(`By    : ${doc.cashierName}`);
  enc.divider(W);

  // ── Line items ──────────────────────────────────────────────────────────────
  for (const item of doc.lines) {
    // First line: product name (truncated)
    const name = item.name.length > W - 2 ? item.name.slice(0, W - 5) + '...' : item.name;
    enc.line(name);
    // Second line: qty × price = total
    const detail = `  ${item.qty} x ${item.unitPrice.toFixed(2)}`;
    const total  = item.lineTotal.toFixed(2);
    const pad    = Math.max(1, W - detail.length - total.length);
    enc.line(`${detail}${' '.repeat(pad)}${total}`);
  }

  enc.divider(W);

  // ── Totals ──────────────────────────────────────────────────────────────────
  enc.alignLeft();
  if (doc.tax > 0)      enc.twoCol('Tax',      fmt(doc.tax),      W);
  if (doc.discount > 0) enc.twoCol('Discount', `-${fmt(doc.discount)}`, W);
  enc.boldOn();
  enc.twoCol('TOTAL', fmt(doc.grandTotal), W);
  enc.boldOff();

  enc.divider(W);

  // ── Payments ────────────────────────────────────────────────────────────────
  for (const p of doc.payments) {
    const label = p.method.replace('_', ' ');
    enc.twoCol(label, fmt(p.amount), W);
  }
  if (doc.change != null && doc.change > 0) {
    enc.twoCol('Change', fmt(doc.change), W);
  }

  // ── QR code ─────────────────────────────────────────────────────────────────
  if (doc.showQrCode) {
    enc.feed(1).alignCenter().qrCode(doc.orderNumber);
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  enc.feed(1).alignCenter();
  const footer = doc.footerText ?? 'Thank you for your purchase!';
  enc.line(footer);

  enc.feed(3).partialCut();

  return enc.toBytes();
}

// ─── Drawer kick bytes (used standalone) ─────────────────────────────────────

export function drawerKickBytes(): Uint8Array {
  return new EscPosEncoder().drawerKick().toBytes();
}
