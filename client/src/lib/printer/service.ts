// PrinterService — transport-agnostic facade
// Detects available transport and sends ESC/POS bytes (or falls back to browser print).
// This is a module-level singleton; React components interact via usePrinter().

import { WebUsbTransport } from './webusb';
import { BluetoothTransport } from './bluetooth';
import { AgentTransport } from './agent';
import { encodeReceipt, drawerKickBytes } from '../receipt/escpos';
import { printReceiptHtml } from '../receipt/html';
import type { ReceiptDocument } from '../receipt/types';
import type { TransportType, PrinterConfig } from './types';

export type PrinterEventType = 'status-change' | 'error';
type Listener = (event: { type: PrinterEventType; connected: boolean; transport: TransportType; error?: string }) => void;

class PrinterService {
  private usb: WebUsbTransport | null = null;
  private bt:  BluetoothTransport | null = null;
  private agent: AgentTransport | null = null;

  private _transport: TransportType = 'none';
  private _connected = false;
  private _error: string | undefined;
  private listeners: Listener[] = [];

  // ── Subscriptions ──────────────────────────────────────────────────────────
  on(listener: Listener) { this.listeners.push(listener); }
  off(listener: Listener) { this.listeners = this.listeners.filter((l) => l !== listener); }

  private emit(type: PrinterEventType) {
    for (const l of this.listeners) {
      l({ type, connected: this._connected, transport: this._transport, error: this._error });
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  get status() { return { connected: this._connected, transport: this._transport, error: this._error }; }

  // ── Connect ────────────────────────────────────────────────────────────────

  async connect(config: PrinterConfig): Promise<void> {
    const t = config.transport;

    try {
      if (t === 'webusb') {
        this.usb = new WebUsbTransport();
        await this.usb.connect();
      } else if (t === 'bluetooth') {
        this.bt = new BluetoothTransport();
        await this.bt.connect();
      } else if (t === 'agent') {
        this.agent = new AgentTransport(config.agentUrl);
        await this.agent.connect();
      }
      this._transport = t;
      this._connected = true;
      this._error = undefined;
    } catch (err) {
      this._connected = false;
      this._error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.emit('status-change');
    }
  }

  // ── Auto-detect ────────────────────────────────────────────────────────────
  // Try agent first (silent probe), then fall back to 'none'
  async autoDetect(config: PrinterConfig): Promise<void> {
    if (config.transport !== 'none') return;  // explicit config wins

    const agentUrl = config.agentUrl ?? 'http://localhost:9977';
    const probe = new AgentTransport(agentUrl);
    if (await probe.checkHealth()) {
      this.agent = probe;
      this._transport = 'agent';
      this._connected = true;
      this._error = undefined;
      this.emit('status-change');
    }
  }

  // ── Print receipt ──────────────────────────────────────────────────────────

  async print(doc: ReceiptDocument): Promise<void> {
    if (!this._connected || this._transport === 'none') {
      // Fall back to browser print dialog
      printReceiptHtml(doc);
      return;
    }

    const bytes = encodeReceipt(doc);

    try {
      if (this._transport === 'webusb' && this.usb) {
        await this.usb.send(bytes);
      } else if (this._transport === 'bluetooth' && this.bt) {
        await this.bt.send(bytes);
      } else if (this._transport === 'agent' && this.agent) {
        await this.agent.send(bytes);
      }
    } catch (err) {
      // Transport failed — fall back to HTML print
      this._error = err instanceof Error ? err.message : String(err);
      this.emit('error');
      printReceiptHtml(doc);
    }
  }

  // ── Cash drawer ────────────────────────────────────────────────────────────

  async kickDrawer(): Promise<void> {
    if (!this._connected || this._transport === 'none') return;
    const bytes = drawerKickBytes();
    try {
      if (this._transport === 'webusb' && this.usb) await this.usb.send(bytes);
      else if (this._transport === 'bluetooth' && this.bt) await this.bt.send(bytes);
      else if (this._transport === 'agent' && this.agent) await this.agent.send(bytes);
    } catch { /* drawer kick failure is non-fatal */ }
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    await this.usb?.disconnect().catch(() => {});
    this.bt?.disconnect();
    this.agent?.disconnect();
    this.usb = null;
    this.bt  = null;
    this.agent = null;
    this._transport = 'none';
    this._connected = false;
    this._error = undefined;
    this.emit('status-change');
  }
}

// Singleton
export const printerService = new PrinterService();
