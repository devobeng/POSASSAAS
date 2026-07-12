export type TransportType = 'webusb' | 'bluetooth' | 'agent' | 'none';

export interface PrinterConfig {
  transport: TransportType;
  paperWidth: 58 | 80;
  // WebUSB — saved after pairing (not serialisable; we just remember "paired")
  usbPaired: boolean;
  // BT — saved after pairing
  btPaired: boolean;
  // Agent
  agentUrl: string;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  transport: 'none',
  paperWidth: 80,
  usbPaired: false,
  btPaired: false,
  agentUrl: 'http://localhost:9977',
};

export interface PrinterStatus {
  connected: boolean;
  transport: TransportType;
  error?: string;
}
