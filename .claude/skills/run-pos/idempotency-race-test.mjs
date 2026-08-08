// Fires N concurrent requests with the SAME clientOrderId to verify only one
// real order is created and the stock decrement isn't double-applied for the
// "losers" of the race.
import fs from 'node:fs';
import crypto from 'node:crypto';

const cashierToken = JSON.parse(fs.readFileSync('./cashier-token.json', 'utf-8')).data.accessToken;
const PRODUCT_ID = process.argv[2];
const CONCURRENCY = Number(process.argv[3] || 20);
const clientOrderId = crypto.randomUUID();

async function createOrder() {
  const res = await fetch('http://localhost:8000/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1000 }],
      clientOrderId,
      createdAtClient: new Date().toISOString(),
    }),
  });
  const body = await res.json();
  return { status: res.status, orderId: body?.data?.id, duplicate: body?.data?.duplicate, message: body?.message };
}

const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => createOrder()));
const orderIds = new Set(results.map((r) => r.orderId).filter(Boolean));
const statusCounts = {};
for (const r of results) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

console.log(`Concurrency: ${CONCURRENCY}, same clientOrderId: ${clientOrderId}`);
console.log('Status code counts:', JSON.stringify(statusCounts));
console.log(`Distinct order IDs returned: ${orderIds.size} (should be exactly 1)`);
console.log(`Responses with duplicate:true: ${results.filter((r) => r.duplicate).length}`);
console.log(`Responses with duplicate:false: ${results.filter((r) => r.duplicate === false).length}`);
const errors = results.filter((r) => ![200, 201].includes(r.status));
if (errors.length) console.log('Unexpected non-2xx responses:', JSON.stringify(errors, null, 2));
