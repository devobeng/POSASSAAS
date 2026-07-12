# Hardware Integration Guide

This document covers thermal printer support, cash drawer control, and barcode scanning in the POS frontend.

---

## Thermal printing

### Transport priority

The POS tries transports in this order and uses the first that succeeds:

1. **WebUSB** — direct USB connection in Chrome/Edge (no driver needed)
2. **Web Bluetooth** — wireless BLE printers in Chrome/Edge
3. **Print agent** — local Node.js process at `http://localhost:9977` (all browsers, all OS)
4. **Browser print dialog** — fallback; opens a styled popup and calls `window.print()`

### Browser compatibility

| Transport | Chrome | Edge | Firefox | Safari |
|-----------|--------|------|---------|--------|
| WebUSB | ✅ 61+ | ✅ 79+ | ❌ | ❌ |
| Web Bluetooth | ✅ 56+ (flag off by default on Linux) | ✅ 79+ | ❌ | ❌ |
| Print agent | ✅ | ✅ | ✅ | ✅ |
| Browser print | ✅ | ✅ | ✅ | ✅ |

**Recommendation:** Use Chrome or Edge. For Firefox/Safari deployments, install the print agent.

### Tested printers

| Printer | USB VID | WebUSB | BLE | Agent |
|---------|---------|--------|-----|-------|
| Epson TM-T88 series | `0x04b8` | ✅ | ❌ | ✅ |
| Epson TM-T20 | `0x04b8` | ✅ | ❌ | ✅ |
| Star TSP100 | `0x0519` | ✅ | ❌ | ✅ |
| Bixolon SRP-350 | `0x1504` | ✅ | ❌ | ✅ |
| Xprinter XP-58/80 | `0x0483` | ✅ | ✅ | ✅ |
| Zjiang ZJ-5805 | `0x0fe6` | ✅ | ✅ | ✅ |
| MPT-II / Goojprt | `0x0416` | ✅ | ✅ | ✅ |
| Generic ESC/POS USB | `0x154f` | ✅ | ❌ | ✅ |

Any ESC/POS-compatible printer should work. Non-listed printers may need the agent.

### Setup

1. Go to **Settings → Hardware** in the POS
2. Select a transport: **USB**, **Bluetooth**, or **Print agent**
3. Click **Connect** — for USB/BT the browser shows a device picker
4. Send a **Test print** to verify
5. Select your **paper width** (58 mm or 80 mm)

The configuration is saved in `localStorage` per browser — each till PC needs its own setup.

### Print agent setup

See [print-agent/README.md](print-agent/README.md) for full installation instructions.

**Quick check:**
```bash
curl http://localhost:9977/health
# Expected: {"ok":true,"version":"1.0.0","printerName":"..."}
```

---

## Cash drawer

### How it works

The POS sends an ESC/POS `ESC p` pulse command (`0x1B 0x70 0x00 0x19 0xFA`) to kick the drawer. The drawer must be connected to the printer's RJ11/RJ12 "DK" port — it is driven by the printer, not directly by the PC.

### Automatic kick

The drawer opens automatically when an order is completed with a **CASH** payment, provided a printer is connected.

### Manual open (managers only)

Users with role `BRANCH_MANAGER`, `STORE_ADMIN`, or `SUPER_ADMIN` see an **Open cash drawer** button in the POS cart panel when a printer is connected. Every manual open is logged to the `AuditLog` table with action `DRAWER_OPENED`.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Drawer doesn't open on cash sale | Printer not connected | Pair a printer in Settings → Hardware |
| Drawer doesn't open on cash sale | Wrong drawer cable | Use a straight-through RJ12 cable (not a phone cable) |
| Drawer opens on every payment | — | Check ChargeModal `hasCash` logic; only `CASH` method triggers kick |

---

## Barcode scanning

### Keyboard wedge (hardware scanners)

Most USB barcode scanners appear as a keyboard. The POS has a global keyboard capture layer that identifies scanner input by **inter-key timing ≤ 30 ms** and a minimum barcode length of 4 characters. Human typing is ignored.

**No configuration needed** — plug in a USB HID scanner and scan. The product is added to the cart instantly with a 1800 Hz beep.

### Camera scanning

Click the camera icon (bottom-right of the product grid) to open the camera scanner. Uses `@zxing/browser` with the rear-facing camera (environment-facing). Supports:

- EAN-13 / EAN-8
- QR Code
- Code 128 / Code 39
- UPC-A / UPC-E
- Data Matrix

Camera scanning triggers the same add-to-cart logic as keyboard wedge scanning.

**Requirements:** HTTPS or `localhost` (browser camera permission requires a secure context).

### Weighted / price-embedded barcodes (EAN-13)

Enable in **Settings → Receipts → Weighted barcodes**.

Format: EAN-13 barcode starting with `2`:

```
2 PPPPP VVVVV C
│ │     │     └── Check digit
│ │     └──────── Value digits (price in cents or weight in grams)
│ └────────────── Product code (matched against barcode field positions 1–5 or SKU suffix)
└──────────────── Weighted barcode prefix
```

Example: `2 01234 01500 X` with type = price → product code `01234`, price = `150.00`

**Supported value types:**
- `price` — digits 6–10 are the price in the smallest currency unit (e.g. `01500` = 15.00 GHS)
- `weight` — digits 6–10 are weight in grams (e.g. `01500` = 1.5 kg, added as qty = 2 rounded kg)

### Scan beep

A short 1800 Hz tone plays via the Web Audio API on every successful scan. If the device has no audio or the browser blocks autoplay, the beep is silently skipped — scanning still works.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Scanner adds characters to search box | Timing threshold too tight | Ensure scanner speed is set to "fast" in scanner config utility |
| No product found after scan | Product barcode not set | Edit the product in **Products** and enter the barcode |
| Weighted barcode not parsing | Feature not enabled | Turn on **Weighted barcodes** in Settings → Receipts |
| Camera not appearing | No HTTPS | Serve the app over HTTPS or use `localhost` |
| Camera shows but doesn't scan | Wrong camera selected | Ensure the rear-facing camera is active; refresh the page |

---

## Receipt settings

Managed in **Settings → Receipts**:

| Setting | Description |
|---------|-------------|
| Header text | Printed at the top of every receipt (e.g. promotional message) |
| Footer text | Printed at the bottom (e.g. return policy) |
| Paper width | 58 mm or 80 mm — must match the physical paper roll |
| Show store logo | Prints the store logo (requires logo upload in Settings → Store) |
| Show QR code | Prints an EAN QR code of the order number |
| Weighted barcodes | Enables price/weight-embedded EAN-13 barcode parsing |
| Embedded value type | Whether the embedded value is a price or a weight |

Receipt settings are stored per store in the database and apply to all receipts — printed and digital.

---

## Offline printing

When the POS is offline, receipts are still generated and displayed on screen. Printing works as long as the transport is local (USB, Bluetooth, or print agent) — these do not require internet connectivity. The receipt document is built from the local order data.
