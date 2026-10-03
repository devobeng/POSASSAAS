import type { Response } from 'express';

// A cell starting with =, +, -, or @ is interpreted as a formula by Excel/
// Sheets when the CSV is opened — free-text fields that flow into exports
// (product names, expense descriptions, etc.) are attacker-controlled, so
// without this a crafted name executes as a formula for whoever opens the
// report (CSV formula injection).
const FORMULA_PREFIX = /^[=+\-@]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (FORMULA_PREFIX.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

export function sendCSV(res: Response, rows: Record<string, unknown>[], filename: string): void {
  const csv = toCSV(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}
