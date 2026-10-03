// WebUSB transport for thermal printers (Chrome/Edge desktop)
// Sends ESC/POS bytes directly to the USB bulk-out endpoint.

// Known thermal printer vendor IDs (allows user to pick any if not listed)
export const THERMAL_USB_FILTERS: USBDeviceFilter[] = [
  { vendorId: 0x04b8 },  // Epson
  { vendorId: 0x0519 },  // Star Micronics
  { vendorId: 0x28e9 },  // Xprinter / Gainscha (generic)
  { vendorId: 0x0416 },  // Winbond Electronics (some generic USB printers)
  { vendorId: 0x0fe6 },  // ICS Advent
  { vendorId: 0x20d1 },  // PARTNER Tech
  { vendorId: 0x1504 },  // Woosim
  { vendorId: 0x0dd4 },  // Custom (Custom printer brand)
];

export class WebUsbTransport {
  private device: USBDevice | null = null;
  private endpointOut = 1;

  get isConnected() { return this.device?.opened === true; }

  async connect(): Promise<void> {
    if (!navigator.usb) throw new Error('WebUSB not supported in this browser');

    this.device = await navigator.usb.requestDevice({ filters: THERMAL_USB_FILTERS });
    await this.device.open();

    // Select configuration 1 (standard for most printers)
    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }

    // Claim the printer interface
    const iface = this.device.configuration!.interfaces[0];
    await this.device.claimInterface(iface.interfaceNumber);

    // Find the bulk-out endpoint
    const epOut = iface.alternate.endpoints.find(
      (e) => e.direction === 'out' && e.type === 'bulk',
    );
    if (epOut) this.endpointOut = epOut.endpointNumber;
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.device || !this.device.opened) throw new Error('USB printer not connected');
    // Copied into a plain ArrayBuffer — see agent.ts for why a bare
    // Uint8Array doesn't satisfy BufferSource under this TS lib version.
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    await this.device.transferOut(this.endpointOut, buffer);
  }

  async disconnect(): Promise<void> {
    try { await this.device?.close(); } catch { /* ignore */ }
    this.device = null;
  }
}
