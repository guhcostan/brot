import type { Bot } from '@brot/protocol';
import type { Browser, Page } from 'playwright-core';
import { hostAllowedForBot } from './egress';

/*
 * Port of images/desktop/brot-browser.mjs, which is the vocabulary the existing browser_* MCP tools use. The
 * commands and their JSON results must stay identical: `open`/`back`/`click`/`key`/`scroll` -> `{title, url}`,
 * `snapshot` -> `{title, url, text}`, `field` -> field details plus `{sensitive, reason}`, and `type` -> `{title, url}`.
 * The snapshot is the same accessibility-tree text with `[ref=N]` tags.
 */

const SNAPSHOT_LIMIT_BYTES = 40 * 1024;
const SENSITIVE_NAME = /(password|passwd|pwd|card|cc-?num|cvv|cvc|credit|iban|account[-_ ]?number|ssn)/i;
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|cc-|one-time-code)/;
const REF = /^\d{1,6}$/;

const NAMED_KEYS: Record<string, string> = {
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
const MODIFIERS: Record<string, string> = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  super: 'Meta',
  cmd: 'Meta',
};

export interface FieldInfo {
  tag: string;
  type: string;
  autocomplete: string;
  name: string;
  label: string;
}

const firstLine = (error: unknown): string => (error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error));

export function parseRef(value: unknown): string {
  const ref = String(value ?? '');
  if (!REF.test(ref)) throw new Error('ref must be a number from the latest snapshot');
  return ref;
}

/** Maps an xdotool-style key name (`Return`, `ctrl+l`) to a Playwright key name. */
export function toPlaywrightKey(key: unknown): string {
  const parts = String(key).split('+');
  const last = parts.pop() ?? '';
  const mapped = parts.map((part) => MODIFIERS[part.toLowerCase()]);
  if (mapped.some((part) => part === undefined)) throw new Error(`unknown modifier in ${String(key)}`);
  const modifiers = mapped.filter((part): part is string => part !== undefined);
  return [...modifiers, NAMED_KEYS[last.toLowerCase()] ?? last].join('+');
}

/** Field details for a ref. A password, one-time code or card field is sensitive and is never typed by the bot. */
export function sensitiveReason(info: FieldInfo | undefined): string | undefined {
  if (info === undefined) return undefined;
  if (info.type === 'password') return 'a password field';
  if (SENSITIVE_AUTOCOMPLETE.test(info.autocomplete)) return 'a password, card or one-time code field';
  if (SENSITIVE_NAME.test(`${info.name} ${info.label}`)) return 'a password or card field';
  return undefined;
}

export function currentPage(browser: Browser): Page | undefined {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
}

export async function ensurePage(browser: Browser): Promise<Page> {
  const existing = currentPage(browser);
  if (existing !== undefined) return existing;
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return context.newPage();
}

function describe(page: Page): Promise<{ title: string; url: string }> {
  return page.title().then((title) => ({ title, url: page.url() }));
}

/*
 * The snapshot and field code runs inside the page, so it is kept as JavaScript source strings and not as
 * functions. Playwright serializes a function by its source text, and tsx/esbuild compiles this module with
 * keepNames, which appends `__name(...)` calls that do not exist in the page. Strings are shipped verbatim.
 */

/** Runs in the page. Clears old refs, tags interactive elements with data-brot-ref, and returns the tree text. */
export const SNAPSHOT_PAGE_SOURCE = String.raw`function (limit) {
  var TEXT_LIMIT = 160;
  var old = document.querySelectorAll('[data-brot-ref]');
  for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-brot-ref');
  var INTERACTIVE = new Set(['button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox',
    'listbox', 'menuitem', 'option', 'switch', 'tab', 'slider', 'spinbutton']);
  var SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'HEAD', 'META', 'LINK']);
  function clean(text, max) {
    var collapsed = (text || '').replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? collapsed.slice(0, max) + '...' : collapsed;
  }
  function visible(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function implicitRole(el) {
    var tag = el.tagName;
    var attr = el.getAttribute('role');
    if (attr) return attr;
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'IMG') return 'img';
    if (tag === 'INPUT') {
      var type = (el.type || 'text').toLowerCase();
      if (type === 'hidden') return null;
      if (['button', 'submit', 'reset', 'image', 'file'].indexOf(type) !== -1) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return null;
  }
  function accessibleName(el) {
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var labelled = labelledby.split(/\s+/).map(function (id) {
        var node = document.getElementById(id);
        return node ? node.textContent || '' : '';
      }).join(' ');
      if (labelled.trim()) return clean(labelled, TEXT_LIMIT);
    }
    var aria = el.getAttribute('aria-label');
    if (aria) return clean(aria, TEXT_LIMIT);
    if (el.labels && el.labels.length > 0) {
      var text = Array.prototype.map.call(el.labels, function (label) { return label.textContent || ''; }).join(' ');
      if (text.trim()) return clean(text, TEXT_LIMIT);
    }
    if (el.tagName === 'IMG') return clean(el.getAttribute('alt') || '', TEXT_LIMIT);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].indexOf(el.type) !== -1) {
      return clean(el.value || el.getAttribute('aria-label') || 'submit', TEXT_LIMIT);
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '', TEXT_LIMIT);
    }
    return clean(el.textContent || el.getAttribute('title') || '', TEXT_LIMIT);
  }
  function valueOf(el) {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return '';
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].indexOf(el.type) !== -1) return '';
    if ((el.getAttribute('type') || '').toLowerCase() === 'password') return '';
    var value;
    if (el.tagName === 'SELECT') {
      value = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent || '' : '';
    } else {
      value = el.value || '';
    }
    return value ? ' value="' + clean(String(value), 80) + '"' : '';
  }
  var budget = limit - 128;
  var lines = [];
  var size = 0;
  var next = 1;
  var truncated = false;
  function emit(line) {
    var bytes = new TextEncoder().encode(line + '\n').length;
    if (size + bytes > budget) { truncated = true; return; }
    size += bytes;
    lines.push(line);
  }
  function walk(el, depth) {
    if (truncated) return;
    if (SKIP_TAGS.has(el.tagName) || !visible(el)) return;
    var indent = '  '.repeat(Math.min(depth, 12));
    var role = implicitRole(el);
    if (role !== null && INTERACTIVE.has(role)) {
      var ref = next++;
      el.setAttribute('data-brot-ref', String(ref));
      emit(indent + '- ' + role + ' "' + accessibleName(el) + '"' + valueOf(el) + ' [ref=' + ref + ']');
      return;
    }
    if (role === 'heading') {
      emit(indent + '- heading "' + clean(el.textContent, TEXT_LIMIT) + '"');
      return;
    }
    if (role === 'img') {
      var alt = clean(el.getAttribute('alt') || '', TEXT_LIMIT);
      if (alt) emit(indent + '- img "' + alt + '"');
      return;
    }
    var direct = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) direct += (node.textContent || '') + ' ';
    }
    var text = clean(direct, TEXT_LIMIT);
    if (text) emit(indent + '- text "' + text + '"');
    for (var j = 0; j < el.children.length; j++) walk(el.children[j], depth + 1);
  }
  walk(document.body, 0);
  if (truncated) lines.push('... (snapshot truncated at 40 kB; scroll or open a narrower page)');
  return { text: lines.join('\n'), truncated: truncated };
}`;

/** Runs in the page. The field details behind a ref, or null when the ref is not on the page. */
export const FIELD_PAGE_SOURCE = String.raw`function (target) {
  var el = document.querySelector('[data-brot-ref="' + target + '"]');
  if (!el) return null;
  var type = String(el.type || el.tagName).toLowerCase();
  var autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  var name = (el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' +
    (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '');
  var label = el.labels
    ? Array.prototype.map.call(el.labels, function (item) { return item.textContent || ''; }).join(' ')
    : '';
  return { tag: el.tagName.toLowerCase(), type: type, autocomplete: autocomplete, name: name.trim(), label: label.trim() };
}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isFieldInfo(value: unknown): value is FieldInfo {
  return (
    isRecord(value) &&
    typeof value.tag === 'string' &&
    typeof value.type === 'string' &&
    typeof value.autocomplete === 'string' &&
    typeof value.name === 'string' &&
    typeof value.label === 'string'
  );
}

function isSnapshot(value: unknown): value is { text: string; truncated: boolean } {
  return isRecord(value) && typeof value.text === 'string' && typeof value.truncated === 'boolean';
}

async function takeSnapshot(page: Page): Promise<{ text: string; truncated: boolean }> {
  const result = await page.evaluate(`(${SNAPSHOT_PAGE_SOURCE})(${SNAPSHOT_LIMIT_BYTES})`);
  if (!isSnapshot(result)) throw new Error('the page did not return a snapshot');
  return result;
}

async function fieldInfo(page: Page, ref: string): Promise<FieldInfo | null> {
  const result = await page.evaluate(`(${FIELD_PAGE_SOURCE})(${JSON.stringify(ref)})`);
  return isFieldInfo(result) ? result : null;
}

/** Validates an `open` URL: http(s) or `about:blank`, and on the bot's egress allowlist. Pure, for the tests. */
export function resolveOpenUrl(bot: Bot, raw: unknown): URL {
  const url = String(raw ?? '');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) && url !== 'about:blank') {
    throw new Error('only http and https URLs can be opened');
  }
  if (url !== 'about:blank' && !hostAllowedForBot(bot, parsed.hostname)) {
    // The same wording the http_request tool uses, so the model recognizes an egress refusal.
    throw new Error(`${parsed.hostname} is not on this bot's egress allowlist.`);
  }
  return parsed;
}

async function run(browser: Browser, bot: Bot, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const page = await ensurePage(browser);
  page.setDefaultTimeout(10_000);

  switch (command) {
    case 'open': {
      const url = resolveOpenUrl(bot, args.url).href;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return describe(page);
    }

    case 'snapshot': {
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
      const snapshot = await takeSnapshot(page);
      return { ...(await describe(page)), text: snapshot.text };
    }

    case 'field': {
      const info = await fieldInfo(page, parseRef(args.ref));
      if (info === null) throw new Error('that ref is not on the page; take a new snapshot');
      const reason = sensitiveReason(info);
      return { ...info, sensitive: reason !== undefined, reason: reason ?? null };
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
      const reason = sensitiveReason((await fieldInfo(page, ref)) ?? undefined);
      if (reason !== undefined) throw new Error(`refused: ${reason} is filled only through the person's takeover`);
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
      const tabs: { index: number; url: string; title: string; active: boolean }[] = [];
      for (const [index, tab] of pages.entries()) {
        tabs.push({ index, url: tab.url(), title: await tab.title().catch(() => ''), active: index === pages.length - 1 });
      }
      return { tabs };
    }

    default:
      throw new Error(`unknown command ${command}`);
  }
}

/**
 * Runs one browser command against an open Chrome and returns the same JSON shape `brot-browser` prints.
 * Failures become one-line errors, as the desktop tool does, without Playwright's call log.
 */
export async function runBrowserCommand(
  browser: Browser,
  bot: Bot,
  command: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return await run(browser, bot, command, args);
  } catch (error) {
    throw new Error(firstLine(error), { cause: error });
  }
}
