// HTML receipt renderer — universal print-dialog fallback
// Injects a <style> block for 80mm/58mm thermal paper and opens window.print()

import type { ReceiptDocument } from './types';

export function printReceiptHtml(doc: ReceiptDocument): void {
  const widthMm = doc.paperWidth === 58 ? '58mm' : '80mm';
  const fmt  = (n: number) => `${doc.currency} ${n.toFixed(2)}`;

  const rows = doc.lines.map((item) => `
    <tr>
      <td colspan="2" class="name">${escHtml(item.name)}</td>
    </tr>
    <tr>
      <td class="detail">${item.qty} × ${item.unitPrice.toFixed(2)}</td>
      <td class="amount">${item.lineTotal.toFixed(2)}</td>
    </tr>`).join('');

  const payments = doc.payments.map((p) => `
    <tr>
      <td>${escHtml(p.method.replace('_', ' '))}</td>
      <td class="amount">${fmt(p.amount)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt ${escHtml(doc.orderNumber)}</title>
<style>
  @page { size: ${widthMm} auto; margin: 4mm 2mm; }
  @media print { body { width: ${widthMm}; } }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    width: ${widthMm};
    max-width: ${widthMm};
    margin: 0 auto;
    padding: 4px;
    color: #000;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .large  { font-size: 16px; }
  hr      { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table   { width: 100%; border-collapse: collapse; }
  td      { padding: 1px 0; vertical-align: top; }
  .name   { font-weight: bold; padding-top: 4px; }
  .detail { color: #555; font-size: 10px; }
  .amount { text-align: right; white-space: nowrap; }
  .total-row td { font-weight: bold; font-size: 13px; border-top: 1px dashed #000; }
  .qr-code { text-align: center; margin: 8px 0; }
  .qr-code canvas, .qr-code svg { max-width: 80px; height: 80px; }
  .footer { text-align: center; margin-top: 8px; font-size: 10px; color: #444; }
</style>
</head>
<body>
  ${doc.headerText ? `<p class="center">${escHtml(doc.headerText)}</p>` : ''}
  <p class="center bold large">${escHtml(doc.storeName)}</p>
  <p class="center">${escHtml(doc.branchName)}</p>
  ${doc.branchAddress ? `<p class="center">${escHtml(doc.branchAddress)}</p>` : ''}
  <hr>
  <table>
    <tr><td>Order #</td><td class="right bold">${escHtml(doc.orderNumber)}</td></tr>
    ${doc.offlineReference && doc.offlineReference !== doc.orderNumber
      ? `<tr><td>Ref</td><td class="right">${escHtml(doc.offlineReference)}</td></tr>` : ''}
    <tr><td>Date</td><td class="right">${new Date(doc.date).toLocaleString()}</td></tr>
    <tr><td>Cashier</td><td class="right">${escHtml(doc.cashierName)}</td></tr>
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    ${doc.tax > 0 ? `<tr><td>Tax</td><td class="amount">${fmt(doc.tax)}</td></tr>` : ''}
    ${doc.discount > 0 ? `<tr><td>Discount</td><td class="amount">-${fmt(doc.discount)}</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td class="amount">${fmt(doc.grandTotal)}</td></tr>
  </table>
  <hr>
  <table>
    ${payments}
    ${doc.change != null && doc.change > 0
      ? `<tr><td>Change</td><td class="amount">${fmt(doc.change)}</td></tr>` : ''}
  </table>
  <p class="footer">${escHtml(doc.footerText ?? 'Thank you for your purchase!')}</p>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=400,height=600');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
