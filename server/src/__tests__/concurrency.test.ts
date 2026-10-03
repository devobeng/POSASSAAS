import { mapLimit } from '../utils/concurrency';

describe('mapLimit', () => {
  it('preserves input order in the results regardless of completion order', async () => {
    const delays = [30, 10, 20, 5]; // deliberately out of completion order
    const results = await mapLimit(delays, 2, (ms, i) => new Promise<number>((resolve) => {
      setTimeout(() => resolve(i), ms);
    }));

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than `limit` callbacks concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('runs every item even when the limit exceeds the item count', async () => {
    const results = await mapLimit([1, 2, 3], 10, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it('propagates a callback rejection', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('returns an empty array for an empty input', async () => {
    const results = await mapLimit([] as number[], 5, async (n) => n);
    expect(results).toEqual([]);
  });
});
