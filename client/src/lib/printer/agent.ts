// Print agent transport — HTTP to a local Node.js agent on port 9977
// The agent runs on the till PC and talks to the OS printer via node-thermal-printer.
// This is the fallback for Safari, Firefox, and any browser without WebUSB/BT.

export class AgentTransport {
  private baseUrl: string;
  private _connected = false;

  constructor(baseUrl = 'http://localhost:9977') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get isConnected() { return this._connected; }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      });
      this._connected = res.ok;
      return res.ok;
    } catch {
      this._connected = false;
      return false;
    }
  }

  async connect(): Promise<void> {
    const ok = await this.checkHealth();
    if (!ok) throw new Error(`Print agent not reachable at ${this.baseUrl}`);
  }

  // Send pre-encoded ESC/POS bytes to the agent
  async send(data: Uint8Array): Promise<void> {
    const res = await fetch(`${this.baseUrl}/print/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => 'Unknown error');
      throw new Error(`Print agent error: ${msg}`);
    }
  }

  // Send structured receipt JSON (agent renders ESC/POS server-side)
  async sendReceipt(receiptJson: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receiptJson),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => 'Unknown error');
      throw new Error(`Print agent error: ${msg}`);
    }
  }

  disconnect(): void { this._connected = false; }
}
