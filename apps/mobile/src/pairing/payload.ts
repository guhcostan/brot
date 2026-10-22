import { DEFAULT_SERVER_PORT } from '@brot/protocol';
import { z } from 'zod';
import { t } from '../i18n';

/**
 * What the desktop's pairing QR encodes: `JSON.stringify({ v: 1, host, port, token })`, built by
 * apps/server/src/pairing.ts. Unknown extra fields are ignored so newer servers stay scannable.
 */
export const PairingQr = z.object({
  v: z.literal(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1),
});
export type PairingQr = z.infer<typeof PairingQr>;

export interface PairingTarget {
  token: string;
  /** Base URL to pair against, or undefined when the QR names an address the phone cannot reach. */
  serverUrl: string | undefined;
  /** Port from the QR, used to prefill a manually typed address. */
  port: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Hosts that mean "this machine" to the server and nothing useful to a phone. */
const LOCAL_ONLY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '::', '[::]']);

export function isLocalOnlyHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return LOCAL_ONLY_HOSTS.has(lower) || lower.startsWith('127.');
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function serverUrlFrom(host: string, port: number): string {
  return `http://${hostForUrl(host.trim())}:${port}`;
}

/** Reads a scanned QR. A raw token (pasted by hand) is accepted too; the server address then comes from the user. */
export function parsePairingCode(raw: string): ParseResult<PairingTarget> {
  // iOS "smart punctuation" turns typed straight quotes into curly ones, which JSON does not accept.
  const text = raw.trim().replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'");
  if (text === '') return { ok: false, error: t('pair.error.empty') };

  if (text.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: t('pair.error.notBrot') };
    }
    const parsed = PairingQr.safeParse(json);
    if (!parsed.success) {
      const version = typeof json === 'object' && json !== null && 'v' in json ? json.v : undefined;
      if (typeof version === 'number' && version !== 1) {
        return { ok: false, error: t('pair.error.newer') };
      }
      return { ok: false, error: t('pair.error.notBrot') };
    }
    const { host, port, token } = parsed.data;
    return {
      ok: true,
      value: { token, port, serverUrl: isLocalOnlyHost(host) ? undefined : serverUrlFrom(host, port) },
    };
  }

  if (/^[A-Za-z0-9_-]{16,}$/.test(text)) {
    return { ok: true, value: { token: text, port: DEFAULT_SERVER_PORT, serverUrl: undefined } };
  }
  return { ok: false, error: t('pair.error.notBrot') };
}

/**
 * Turns what the user typed ("192.168.1.20", "mac.local:8799", "https://brot.example.com") into a
 * base URL. A bare host gets http and `defaultPort`; anything other than http(s) is rejected.
 */
export function normalizeServerUrl(input: string, defaultPort: number = DEFAULT_SERVER_PORT): ParseResult<string> {
  const text = input.trim();
  if (text === '') return { ok: false, error: t('pair.error.noAddress') };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return { ok: false, error: t('pair.error.badAddress') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: t('pair.error.scheme') };
  }
  if (url.username || url.password) return { ok: false, error: t('pair.error.credentials') };
  if (!url.hostname) return { ok: false, error: t('pair.error.badAddress') };
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/[^/]*:\d+/i.test(hasScheme ? text : `http://${text}`);
  const port = explicitPort || hasScheme ? url.port : String(defaultPort);
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, value: `${url.protocol}//${url.hostname}${port ? `:${port}` : ''}${path}` };
}
