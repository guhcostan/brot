#!/usr/bin/env node
// Drives the bot desktop's Chromium over CDP (127.0.0.1:9222). Usage: brot-browser <command> [json-args]
// Prints one JSON object on stdout. On failure prints {"error": "..."} and exits 1.
import { pathToFileURL } from 'node:url';

const CDP_URL = 'http://127.0.0.1:9222';
const PLAYWRIGHT_PATH = '/usr/local/lib/node_modules/playwright-core/index.mjs';
const SNAPSHOT_LIMIT_BYTES = 40 * 1024;
const SENSITIVE_NAME = /(password|passwd|pwd|card|cc-?num|cvv|cvc|credit|iban|account[-_ ]?number|ssn)/i;
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|cc-|one-time-code)/;
const REF = /^\d{1,6}$/;

const NAMED_KEYS = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  space: 'Space',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};
const MODIFIERS = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta', super: 'Meta', cmd: 'Meta' };

function fail(message) {
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}

function parseRef(value) {
  const ref = String(value ?? '');
  if (!REF.test(ref)) throw new Error('ref must be a number from the latest snapshot');
  return ref;
}

/** Maps an xdotool-style key name (`Return`, `ctrl+l`) to a Playwright key name. */
function toPlaywrightKey(key) {
  const parts = String(key).split('+');
  const last = parts.pop() ?? '';
  const mapped = parts.map((part) => MODIFIERS[part.toLowerCase()]);
  if (mapped.some((part) => part === undefined)) throw new Error(`unknown modifier in ${key}`);
  const base = NAMED_KEYS[last.toLowerCase()] ?? last;
  return [...mapped, base].join('+');
}

async function connect(chromium) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(CDP_URL, { timeout: 5_000 });
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`the browser is not running: ${error.message.split('\n')[0]}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function currentPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  return pages.at(-1);
}

async function ensurePage(browser) {
  const existing = currentPage(browser);
  if (existing) return existing;
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return context.newPage();
}

function describe(page) {
  return page.title().then((title) => ({ url: page.url(), title }));
}

/** Runs in the page. Clears old refs, tags interactive elements with data-brot-ref, and returns the tree text. */
function buildSnapshot(limit) {
  const TEXT_LIMIT = 160;
  for (const old of document.querySelectorAll('[data-brot-ref]')) old.removeAttribute('data-brot-ref');
  const INTERACTIVE = new Set(['button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox', 'listbox', 'menuitem', 'option', 'switch', 'tab', 'slider', 'spinbutton']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'HEAD', 'META', 'LINK']);
  const clean = (text, max) => {
    const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
  };
  const visible = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const implicitRole = (el) => {
    const tag = el.tagName;
    if (el.getAttribute('role')) return el.getAttribute('role');
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'IMG') return 'img';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return null;
      if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return null;
  };
  const accessibleName = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (text.trim()) return clean(text, TEXT_LIMIT);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria, TEXT_LIMIT);
    if (el.labels && el.labels.length > 0) {
      const text = [...el.labels].map((label) => label.textContent ?? '').join(' ');
      if (text.trim()) return clean(text, TEXT_LIMIT);
    }
    if (el.tagName === 'IMG') return clean(el.getAttribute('alt') ?? '', TEXT_LIMIT);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) {
      return clean(el.value || el.getAttribute('aria-label') || 'submit', TEXT_LIMIT);
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return clean(el.getAttribute('placeholder') ?? el.getAttribute('title') ?? el.getAttribute('name') ?? '', TEXT_LIMIT);
    }
    return clean(el.textContent ?? el.getAttribute('title') ?? '', TEXT_LIMIT);
  };
  const valueOf = (el) => {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return '';
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return '';
    if ((el.getAttribute('type') || '').toLowerCase() === 'password') return '';
    const value = el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.textContent ?? '' : el.value ?? '';
    return value ? ` value="${clean(String(value), 80)}"` : '';
  };

  // The truncation note needs room, so the tree itself stops a little short of the limit.
  const budget = limit - 128;
  const lines = [];
  let size = 0;
  let next = 1;
  let truncated = false;
  const emit = (line) => {
    const bytes = new TextEncoder().encode(`${line}\n`).length;
    if (size + bytes > budget) {
      truncated = true;
      return false;
    }
    size += bytes;
    lines.push(line);
    return true;
  };

  const walk = (el, depth) => {
    if (truncated) return;
    if (SKIP_TAGS.has(el.tagName) || !visible(el)) return;
    const indent = '  '.repeat(Math.min(depth, 12));
    const role = implicitRole(el);
    if (role && INTERACTIVE.has(role)) {
      const ref = next++;
      el.setAttribute('data-brot-ref', String(ref));
      emit(`${indent}- ${role} "${accessibleName(el)}"${valueOf(el)} [ref=${ref}]`);
      return;
    }
    if (role === 'heading') {
      emit(`${indent}- heading "${clean(el.textContent, TEXT_LIMIT)}"`);
      return;
    }
    if (role === 'img') {
      const alt = clean(el.getAttribute('alt') ?? '', TEXT_LIMIT);
      if (alt) emit(`${indent}- img "${alt}"`);
      return;
    }
    const direct = [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ');
    const text = clean(direct, TEXT_LIMIT);
    if (text) emit(`${indent}- text "${text}"`);
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  if (truncated) lines.push('... (snapshot truncated at 40 kB; scroll or open a narrower page)');
  return { text: lines.join('\n'), truncated };
}

/** Field details for a ref. A password, one-time code or card field is sensitive and is never typed by the bot. */
async function fieldInfo(page, ref) {
  return page.evaluate((target) => {
    const el = document.querySelector(`[data-brot-ref="${target}"]`);
    if (!el) return null;
    const type = String(el.type || el.tagName).toLowerCase();
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`;
    const labels = el.labels ? [...el.labels].map((label) => label.textContent || '').join(' ') : '';
    return { tag: el.tagName.toLowerCase(), type, autocomplete, name: name.trim(), label: labels.trim() };
  }, ref);
}

function sensitiveReason(info) {
  if (!info) return undefined;
  if (info.type === 'password') return 'a password field';
  if (SENSITIVE_AUTOCOMPLETE.test(info.autocomplete)) return 'a password, card or one-time code field';
  if (SENSITIVE_NAME.test(`${info.name} ${info.label}`)) return 'a password or card field';
  return undefined;
}

async function run(command, args) {
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT_PATH).href);
  const browser = await connect(chromium);
  const page = await ensurePage(browser);
  page.setDefaultTimeout(10_000);

  switch (command) {
    case 'open': {
      const url = String(args.url ?? '');
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) && url !== 'about:blank') {
        throw new Error('only http and https URLs can be opened');
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return describe(page);
    }
    case 'snapshot': {
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
      const snapshot = await page.evaluate(buildSnapshot, SNAPSHOT_LIMIT_BYTES);
      return { ...(await describe(page)), text: snapshot.text };
    }
    case 'field': {
      const info = await fieldInfo(page, parseRef(args.ref));
      if (!info) throw new Error('that ref is not on the page; take a new snapshot');
      return { ...info, sensitive: sensitiveReason(info) !== undefined, reason: sensitiveReason(info) ?? null };
    }
    case 'click': {
      const locator = page.locator(`[data-brot-ref="${parseRef(args.ref)}"]`);
      if ((await locator.count()) === 0) throw new Error('that ref is not on the page; take a new snapshot');
      await locator.first().click();
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => undefined);
      return describe(page);
    }
    case 'type': {
      const ref = parseRef(args.ref);
      const reason = sensitiveReason(await fieldInfo(page, ref));
      if (reason) throw new Error(`refused: ${reason} is filled only through the person's takeover`);
      const locator = page.locator(`[data-brot-ref="${ref}"]`);
      if ((await locator.count()) === 0) throw new Error('that ref is not on the page; take a new snapshot');
      await locator.first().fill(String(args.text ?? ''));
      if (args.submit === true) await locator.first().press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => undefined);
      return describe(page);
    }
    case 'key': {
      await page.keyboard.press(toPlaywrightKey(args.key));
      return describe(page);
    }
    case 'scroll': {
      const direction = args.direction === 'up' ? -1 : args.direction === 'down' ? 1 : undefined;
      if (direction === undefined) throw new Error('direction must be up or down');
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, direction * 600);
      return describe(page);
    }
    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      return describe(page);
    }
    case 'tabs': {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const tabs = [];
      for (const [index, tab] of pages.entries()) {
        tabs.push({ index, url: tab.url(), title: await tab.title().catch(() => ''), active: index === pages.length - 1 });
      }
      return { tabs };
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
}

const [command, rawArgs] = process.argv.slice(2);
if (!command) fail('usage: brot-browser <command> [json-args]');
let args = {};
try {
  args = rawArgs === undefined ? {} : JSON.parse(rawArgs);
} catch {
  fail('arguments must be a JSON object');
}
if (typeof args !== 'object' || args === null || Array.isArray(args)) fail('arguments must be a JSON object');

try {
  const result = await run(command, args);
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.message.split('\n')[0] : String(error));
}
