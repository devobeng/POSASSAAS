import { toCSV } from '../utils/csv';

describe('toCSV', () => {
  it('quotes cells containing commas, quotes, or newlines', () => {
    const csv = toCSV([{ name: 'Widget, Deluxe' }, { name: 'Say "hi"' }, { name: 'Line1\nLine2' }]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('"Widget, Deluxe"');
    expect(lines[2]).toBe('"Say ""hi"""');
    expect(lines[3]).toBe('"Line1\nLine2"');
  });

  it('prefixes a leading apostrophe onto formula-triggering cells (CSV formula injection guard)', () => {
    const csv = toCSV([
      { name: '=HYPERLINK("http://evil.example")' },
      { name: '+1+1' },
      { name: '-1+1' },
      { name: '@SUM(A1:A9)' },
      { name: 'Regular Product' },
    ]);
    const rows = csv.split('\r\n');
    // Excel/Sheets no longer read this as a formula once prefixed with '.
    // The embedded double-quote still forces normal CSV quoting on top.
    expect(rows[1]).toBe('"\'=HYPERLINK(""http://evil.example"")"');
    expect(rows[2]).toBe("'+1+1");
    expect(rows[3]).toBe("'-1+1");
    expect(rows[4]).toBe("'@SUM(A1:A9)");
    expect(rows[5]).toBe('Regular Product');
  });

  it('leaves ordinary cells untouched', () => {
    expect(toCSV([{ name: 'Widget', price: 10 }])).toBe('name,price\r\nWidget,10');
  });

  it('returns an empty string for no rows', () => {
    expect(toCSV([])).toBe('');
  });
});
