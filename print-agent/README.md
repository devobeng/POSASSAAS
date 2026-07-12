# POS Print Agent

A tiny Express server that runs locally on the till PC and bridges the browser POS to an OS-level thermal printer. The browser's printer service (`AgentTransport`) connects to it at `http://localhost:9977`.

## Why it exists

WebUSB and Web Bluetooth require the printer to be physically visible to the browser. Many Windows environments use shared network printers or USB printers exposed via the Windows spooler — neither of which WebUSB can address. The print agent solves this by running as a native process with OS printer access.

## Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Returns `{ ok: true }` — used by the browser to detect the agent |
| `POST` | `/print/raw` | `application/octet-stream` (ESC/POS bytes) | Sends pre-built ESC/POS bytes directly to the printer |
| `POST` | `/print` | JSON `ReceiptDocument` | The agent builds ESC/POS and prints (fallback if browser can't encode) |

The browser always prefers `/print/raw` with ESC/POS bytes built in the browser. `/print` exists as a fallback.

## Requirements

- Node.js 18+ (or use the packaged binary — see below)
- A thermal printer accessible via:
  - **Windows**: a printer name in the Windows spooler (Printers & Scanners)
  - **Linux/macOS**: a device file (`/dev/usb/lp0`) or a named printer via `lp`

## Quick start (development)

```bash
cd print-agent
npm install
# Windows (set printer name as shown in Printers & Scanners):
PRINTER_NAME="POS-80" npm run dev
# Linux/Mac (USB device file):
PRINTER_PATH=/dev/usb/lp0 npm run dev
```

The agent starts on `http://127.0.0.1:9977`. Open the POS, go to **Settings → Hardware**, select **Print agent** as the transport, and click **Connect**.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9977` | TCP port to listen on |
| `PRINTER_NAME` | `""` | Windows spooler printer name (e.g. `POS-80`) |
| `PRINTER_PATH` | `/dev/usb/lp0` | Linux/Mac device path (ignored if `PRINTER_NAME` is set) |

## Build a standalone binary (no Node.js required on till PC)

```bash
npm install
npm run build          # TypeScript → dist/
# Then package for your platform:
npm run pkg:win        # → bin/print-agent-win.exe
npm run pkg:mac        # → bin/print-agent-mac
npm run pkg:linux      # → bin/print-agent-linux
```

Requires [`pkg`](https://github.com/vercel/pkg) (installed as a devDependency).

## Windows: run as a background service

Use [NSSM](https://nssm.cc) or Task Scheduler to start `print-agent-win.exe` at login:

```powershell
# With NSSM (run as Administrator):
nssm install POSPrintAgent "C:\pos\print-agent-win.exe"
nssm set POSPrintAgent AppEnvironmentExtra PRINTER_NAME=POS-80
nssm start POSPrintAgent
```

## Linux/macOS: run as a systemd service

```ini
# /etc/systemd/system/pos-print-agent.service
[Unit]
Description=POS Print Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/print-agent-linux
Environment=PRINTER_NAME=POS-80
Restart=always
User=pos

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pos-print-agent
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Browser shows "Agent not found" | Agent not running or wrong port | Check the process is running: `curl http://localhost:9977/health` |
| "Print failed" after connecting | Wrong printer name | On Windows: check exact name in **Settings → Printers & Scanners** |
| Nothing prints on Linux | Permission denied on `/dev/usb/lp0` | Add your user to the `lp` group: `sudo usermod -aG lp $USER` |
| Chinese/special chars garbled | Wrong code page | Change printer code page DIP switch to PC852 or Latin-1 |
| Receipt cuts in wrong place | Wrong paper width set | Verify paper width in **Settings → Receipts** matches physical roll |
