// Fires N concurrent real HTTP order-creation requests against the running
// dev server to verify the atomic stock guard + atomic order-number fix hold
// under genuine concurrency (not simulated via Promise.all in a unit test
// with mocked Prisma).
import fs from 'node:fs';

const cashierToken = JSON.parse(fs.readFileSync('./cashier-token.json', 'utf-8')).data.accessToken;
const PRODUCT_ID = process.argv[2];
const CONCURRENCY = Number(process.argv[3] || 150);

async function createOrder(i) {
  const res = await fetch('http://localhost:8000/api/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cashierToken}`,
    },
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1000 }],
    }),
  });
  const body = await res.json();
  return { i, status: res.status, orderNumber: body?.data?.orderNumber, message: body?.message };
}

const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => createOrder(i)));

const successes = results.filter((r) => r.status === 201);
const failures = results.filter((r) => r.status !== 201);
const orderNumbers = successes.map((r) => r.orderNumber);
const uniqueOrderNumbers = new Set(orderNumbers);

console.log(`Concurrency: ${CONCURRENCY}`);
console.log(`Successes (201): ${successes.length}`);
console.log(`Failures (non-201): ${failures.length}`);
console.log(`Unique order numbers among successes: ${uniqueOrderNumbers.size} (should equal successes count)`);
console.log(`DUPLICATE order numbers: ${orderNumbers.length - uniqueOrderNumbers.size}`);

const failureReasons = {};
for (const f of failures) {
  failureReasons[f.message] = (failureReasons[f.message] || 0) + 1;
}
console.log('Failure reasons:', JSON.stringify(failureReasons, null, 2));
