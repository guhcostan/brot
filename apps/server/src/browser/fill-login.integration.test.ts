import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensurePage, fillLogin } from './driver';
import { launchChrome, resolveChromeBinary } from './launch';

/** This suite drives the real Chrome without the egress proxy, against a page served on loopback. */
function chromeInstalled(): boolean {
  try {
    resolveChromeBinary();
    return true;
  } catch {
    return false;
  }
}

const chromeFound = chromeInstalled();

const FORM = `<!doctype html><html><body>
<form method="post" action="/submit">
  <input type="email" name="email" autocomplete="username" placeholder="Email">
  <input type="password" name="password" autocomplete="current-password" placeholder="Password">
  <input type="text" name="otp" autocomplete="one-time-code" inputmode="numeric" placeholder="One-time code">
  <button type="submit">Sign in</button>
</form></body></html>`;
const PLAIN = `<!doctype html><html><body>
<form method="post" action="/submit"><input type="email" name="email"><button type="submit">Continue</button></form>
</body></html>`;

interface FormServer {
  server: Server;
  port: number;
  submissions: string[];
}

async function startFormServer(): Promise<FormServer> {
  const submissions: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        submissions.push(body);
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<title>Signed in</title><p>Signed in</p>');
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(request.url === '/plain' ? PLAIN : FORM);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return { server, port: typeof address === 'object' && address !== null ? address.port : 0, submissions };
}

describe.skipIf(!chromeFound)('fillLogin against a real Chrome page', () => {
  it(
    'types the saved values into the visible fields, submits, and refuses another host without leaking them',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-fill-login-'));
      const form = await startFormServer();
      const chrome = await launchChrome(resolveChromeBinary(), { profile: join(home, 'profile') });
      const credentials = {
        host: 'localhost',
        username: 'ada@example.com',
        password: 'correct horse battery staple',
        totp: '123456',
      };
      try {
        const page = await ensurePage(chrome.browser);
        await page.goto(`http://localhost:${form.port}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // A mismatch is refused before anything is typed, and the refusal names hosts only.
        const mismatch = await fillLogin(page, { ...credentials, host: 'example.com' }).catch((error: unknown) => error);
        expect(mismatch).toBeInstanceOf(Error);
        expect((mismatch as Error).message).toContain('example.com');
        expect((mismatch as Error).message).not.toContain(credentials.username);
        expect((mismatch as Error).message).not.toContain(credentials.password);
        expect(form.submissions).toHaveLength(0);

        await fillLogin(page, credentials);
        // The form submitted with all three values in the right fields, and the page followed the response.
        expect(form.submissions).toHaveLength(1);
        const submitted = new URLSearchParams(form.submissions[0] ?? '');
        expect(submitted.get('email')).toBe(credentials.username);
        expect(submitted.get('password')).toBe(credentials.password);
        expect(submitted.get('otp')).toBe(credentials.totp);
        expect(page.url()).toContain('/submit');

        // A page with no password field is a value-free refusal, and nothing is submitted.
        await page.goto(`http://localhost:${form.port}/plain`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const missing = await fillLogin(page, credentials).catch((error: unknown) => error);
        expect(missing).toBeInstanceOf(Error);
        expect((missing as Error).message).toMatch(/no visible password field/);
        expect((missing as Error).message).not.toContain(credentials.password);
        expect(form.submissions).toHaveLength(1);
      } finally {
        await chrome.close();
        await new Promise<void>((resolve) => form.server.close(() => resolve()));
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
