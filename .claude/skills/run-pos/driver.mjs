// Batch driver for the POS SaaS web app (client + server).
// Reads commands one per line from stdin (pipe a heredoc), runs them against
// a headless Chromium instance driving the already-running Next.js dev
// server, and exits when stdin closes. No tmux/REPL needed — see SKILL.md.
//
// Requires: `npm install` in this directory once (installs playwright-core),
// and CHROME_PATH pointing at a real Chrome/Edge binary (see SKILL.md).
import { chromium } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.resolve(import.meta.dirname, 'shots');
const CHROME_PATH = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;
const consoleErrors = [];

function need() {
  if (!page) throw new Error('call launch first');
}

const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched');
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    console.log('launched');
  },

  async nav(url) {
    need();
    const target = /^https?:\/\//.test(url) ? url : CLIENT_URL + url;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    console.log('nav ->', page.url());
  },

  // Waits for a CSS selector. Use this instead of a raw sleep — first paint
  // after `nav` can take a few seconds (SessionBootstrap refresh + Next.js
  // route compile on first hit), and `domcontentloaded` fires before that
  // settles — see Gotchas in SKILL.md.
  async wait(args) {
    need();
    const { value: sel, timeout } = splitTrailingTimeout(args);
    try {
      await page.waitForSelector(sel, { timeout });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async 'wait-text'(args) {
    need();
    const { value: text, timeout } = splitTrailingTimeout(args);
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout });
      console.log('found text:', text);
    } catch {
      console.log('TIMEOUT:', text);
    }
  },

  // React-controlled inputs: use Playwright's fill (goes through the real
  // input pipeline / fires onChange), never page.evaluate(el.value = ...).
  async fill(args) {
    need();
    const [sel, ...rest] = args.split(' ');
    await page.fill(sel, rest.join(' '));
    console.log('fill', sel, 'ok');
  },

  async click(sel) {
    need();
    await page.click(sel);
    console.log('click', sel, 'ok');
  },

  async 'click-text'(text) {
    need();
    const loc = page.getByText(text, { exact: false }).first();
    await loc.click();
    console.log('click-text', JSON.stringify(text), 'ok');
  },

  async press(key) {
    need();
    await page.keyboard.press(key);
    console.log('press', key, 'ok');
  },

  async ss(name) {
    need();
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async text(sel) {
    need();
    const out = await page.evaluate(
      (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null,
    );
    console.log(out);
  },

  async eval(expr) {
    need();
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async url() {
    need();
    console.log(page.url());
  },

  console() {
    if (!consoleErrors.length) return console.log('(no console errors captured)');
    consoleErrors.forEach((e) => console.log('ERR:', e));
  },

  // App-specific helper: fills and submits the login form, waits for the
  // post-login redirect to /dashboard. Encodes the auth path so callers
  // don't have to know the field selectors.
  async login(args) {
    need();
    const [email, password] = args.split(' ');
    if (!page.url().includes('/login')) await COMMANDS.nav('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL('**/dashboard', { timeout: 15_000 });
      console.log('login ok ->', page.url());
    } catch {
      console.log('login TIMEOUT, still at', page.url());
    }
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
    console.log('closed');
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const sp = trimmed.indexOf(' ');
  const cmd = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const arg = sp === -1 ? '' : trimmed.slice(sp + 1);
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown command:', cmd, '(try: help)');
    return;
  }
  try {
    await fn(arg);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
});

rl.on('close', async () => {
  await COMMANDS.quit();
  process.exit(0);
});
