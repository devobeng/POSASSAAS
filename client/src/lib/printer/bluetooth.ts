// Web Bluetooth transport for BLE thermal printers (Android tablets, etc.)
// Most BT thermal printers expose a BLE UART or SPP-proxy service.
// We try two common service/characteristic UUID pairs in order.

// Nordic UART Service (NUS) — used by many modern BT printers
const NUS_SERVICE    = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR    = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';  // write to printer

// Generic 0xff00 service — used by Xprinter, GOOJPRT, MUNBYN and many others
const FF00_SERVICE   = '000018f0-0000-1000-8000-00805f9b34fb';
const FF00_TX_CHAR   = '00002af1-0000-1000-8000-00805f9b34fb';

// Zjiang (ZJ) series printers
const ZJ_SERVICE     = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const ZJ_TX_CHAR     = '49535343-8841-43f4-a8d4-ecbe34729bb3';

const SERVICE_PROFILES = [
  { service: NUS_SERVICE,  txChar: NUS_TX_CHAR  },
  { service: FF00_SERVICE, txChar: FF00_TX_CHAR },
  { service: ZJ_SERVICE,   txChar: ZJ_TX_CHAR   },
];

const CHUNK_SIZE = 512;  // BLE MTU safe chunk

export class BluetoothTransport {
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private _connected = false;

  get isConnected() { return this._connected; }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported in this browser');

    const device = await navigator.bluetooth.requestDevice({
      // acceptAllDevices to show all BT devices; alternatively filters by name prefix
      acceptAllDevices: true,
      optionalServices: SERVICE_PROFILES.map((p) => p.service),
    });

    const server = await device.gatt!.connect();

    // Try each service profile until one works
    for (const profile of SERVICE_PROFILES) {
      try {
        const svc  = await server.getPrimaryService(profile.service);
        this.char  = await svc.getCharacteristic(profile.txChar);
        this._connected = true;

        device.addEventListener('gattserverdisconnected', () => {
          this._connected = false;
          this.char = null;
        });
        return;
      } catch {
        // try next profile
      }
    }
    throw new Error('No compatible BLE UART service found on this device');
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.char) throw new Error('BT printer not connected');
    // BLE requires chunking since MTU is typically 20–512 bytes
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      const slice = data.slice(offset, offset + CHUNK_SIZE);
      // Copied into a plain ArrayBuffer — see agent.ts for why a bare
      // Uint8Array doesn't satisfy BufferSource under this TS lib version.
      const chunk = new ArrayBuffer(slice.byteLength);
      new Uint8Array(chunk).set(slice);
      await this.char.writeValueWithoutResponse(chunk);
      // Small delay between chunks to avoid buffer overflow on slower printers
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  disconnect(): void {
    this._connected = false;
    this.char = null;
  }
}
