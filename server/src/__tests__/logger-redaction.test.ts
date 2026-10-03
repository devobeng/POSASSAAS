import express from 'express';
import request from 'supertest';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'stream';

// Regression test for the auth-token-in-logs fix: pino-http's default req
// serializer logs the full req.headers object on every request, which
// previously included the raw Authorization bearer token and any
// Set-Cookie/Cookie value — readable by anyone with log access. This
// exercises the SAME pinoHttp configuration app.ts uses (logger + redact)
// against a real HTTP request/response cycle and inspects the captured
// output, rather than mocking pino-http's internals.
describe('pino-http request logging redacts sensitive headers', () => {
  it('never emits the Authorization or Cookie header value in a log line', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const baseLogger = pino(destination);
    const app = express();
    app.use(
      pinoHttp({
        logger: baseLogger,
        autoLogging: true,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
      }),
    );
    app.get('/whoami', (_req, res) => res.status(200).json({ ok: true }));

    await request(app)
      .get('/whoami')
      .set('Authorization', 'Bearer super-secret-access-token')
      .set('Cookie', 'refreshToken=super-secret-refresh-token');

    const output = lines.join('');
    expect(output).not.toContain('super-secret-access-token');
    expect(output).not.toContain('super-secret-refresh-token');
    // Sanity check the request actually got logged at all (i.e. this isn't
    // vacuously passing because nothing was captured) and that the redacted
    // key is simply absent, not just empty.
    expect(output).toContain('"url":"/whoami"');
    expect(output).not.toMatch(/"authorization"/);
    expect(output).not.toMatch(/"cookie"/);
  });
});
