import { lookup } from 'node:dns/promises';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import type { Repos } from '@brot/db';
import { z } from 'zod';
import type { ApprovalScope } from '../broker';
import type { EventBus } from '../bus';
import { hostAllowed, isForbiddenAddress } from './egress';
import { findSecretRefs, inputSchemaOf, invalidArguments, replaceSecretRefs } from './helpers';
import type { BrotTool, PreparedCall, ToolResult } from './types';

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
/** Headers the request line or the body framing owns. The caller's values for them are dropped. */
const FRAMING_HEADERS: ReadonlySet<string> = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

const HttpRequestInput = z.object({
  method: z.enum(HTTP_METHODS),
  url: z.string().min(1).max(2048),
  headers: z
    .record(
      z
        .string()
        .max(128)
        .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'must be a valid header name'),
      z.string().max(4096),
    )
    .optional(),
  body: z.string().max(262_144).optional(),
});

export interface HttpSendRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** The address that was validated for `url.hostname`. The connection goes there, so the name is not resolved again. */
  address: string;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  contentType?: string;
  body: string;
  truncated: boolean;
}

export interface HttpOptions {
  /** Resolves a hostname to its addresses. Defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Performs one request to a validated address. Defaults to an HTTP(S) client pinned to that address. */
  send?: (request: HttpSendRequest) => Promise<HttpResponse>;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

/**
 * The `http_request` tool. The server makes the request, so the bot's computer needs no network beyond its
 * model provider. A host is reached only when it is on the bot's egress allowlist and every address it
 * resolves to is public. Redirects are returned, not followed, so a redirect cannot reach another host.
 */
export function createHttpRequestTool(deps: { repos: Repos; bus: EventBus } & HttpOptions): BrotTool {
  const { repos, bus } = deps;
  const resolve = deps.resolve ?? resolveSystem;
  const send = deps.send ?? sendPinned;
  const maxResponseBytes = deps.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function authorize(scope: ApprovalScope, hostname: string): Promise<{ address: string } | { error: string }> {
    const bot = await repos.bots.get(scope.botId);
    if (!bot) return { error: 'The bot no longer exists.' };
    const egress = bot.egress;
    if (egress?.mode !== 'allowlist' || !hostAllowed(hostname, egress.allow)) {
      await bus.publish({ type: 'network.blocked', threadId: scope.threadId, runId: scope.runId, botId: scope.botId, host: hostname });
      return { error: `${hostname} is not on this bot's egress allowlist.` };
    }
    let addresses: string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      return { error: `${hostname} could not be resolved.` };
    }
    const address = addresses[0];
    if (address === undefined || addresses.some(isForbiddenAddress)) {
      await bus.publish({ type: 'network.blocked', threadId: scope.threadId, runId: scope.runId, botId: scope.botId, host: hostname });
      return { error: `${hostname} resolves to a private, loopback or link-local address.` };
    }
    return { address };
  }

  async function execute(
    scope: ApprovalScope,
    args: z.infer<typeof HttpRequestInput>,
    hostname: string,
    values: Record<string, string>,
  ): Promise<ToolResult> {
    const parsed = parseUrl(replaceSecretRefs(args.url, values));
    if ('error' in parsed || parsed.url.hostname !== hostname) {
      return { ok: false, output: 'The URL changed host after its secret was filled in, so nothing was sent.' };
    }
    const check = await authorize(scope, hostname);
    if ('error' in check) return { ok: false, output: check.error };

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(args.headers ?? {})) {
      if (!FRAMING_HEADERS.has(name.toLowerCase())) headers[name] = replaceSecretRefs(value, values);
    }
    const response = await send({
      url: parsed.url,
      method: args.method,
      headers,
      body: args.body === undefined ? undefined : replaceSecretRefs(args.body, values),
      address: check.address,
      signal: AbortSignal.timeout(timeoutMs),
      maxResponseBytes,
    });
    return { ok: response.status < 400, output: formatResponse(response, maxResponseBytes) };
  }

  return {
    spec: {
      name: 'http_request',
      description:
        "Make an HTTP request to a host on this bot's egress allowlist. GET and HEAD are reads; other methods change things outside and always need the user's approval. Put secrets in headers or the URL as secret:// references: the value is filled in after approval and is never shown to you.",
      inputSchema: inputSchemaOf(HttpRequestInput),
      risk: 'irreversible',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = HttpRequestInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const args = parsed.data;
      const url = parseUrl(args.url);
      if ('error' in url) return { error: url.error };
      const readOnly = READ_METHODS.has(args.method);
      if (readOnly && args.body !== undefined) return { error: `${args.method} requests take no body.` };
      const check = await authorize(scope, url.url.hostname);
      if ('error' in check) return { error: check.error };

      return {
        risk: readOnly ? 'read' : 'irreversible',
        kind: args.method === 'DELETE' ? 'delete' : readOnly ? 'other' : 'send',
        summary: `${args.method} ${args.url}`.slice(0, 300),
        secrets: findSecretRefs(args.url, ...Object.values(args.headers ?? {}), args.body ?? ''),
        run: (values) => execute(scope, args, url.url.hostname, values),
      };
    },
  };
}

function parseUrl(text: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'url must be an absolute URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http and https URLs can be requested.' };
  if (url.username !== '' || url.password !== '') {
    return { error: 'URLs must not contain credentials. Send them in an Authorization header as a secret:// reference.' };
  }
  return { url };
}

async function resolveSystem(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function formatResponse(response: HttpResponse, maxBytes: number): string {
  const lines = [`HTTP ${response.status} ${response.statusText}`.trimEnd()];
  if (response.contentType) lines.push(`content-type: ${response.contentType}`);
  const note = response.truncated ? `\n\n[response truncated after ${maxBytes} bytes]` : '';
  return `${lines.join('\n')}\n\n${response.body}${note}`;
}

/**
 * Sends one request to the address already validated for the host. The name is still used for TLS and the
 * Host header, but the socket goes to `request.address` through a lookup override, so a DNS answer that
 * changed after validation cannot redirect the connection.
 */
export function sendPinned(request: HttpSendRequest): Promise<HttpResponse> {
  const family = isIP(request.address) === 6 ? 6 : 4;
  const options = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    lookup: (_hostname: string, lookupOptions: { all?: boolean }, callback: PinnedCallback) => {
      if (lookupOptions.all) callback(null, [{ address: request.address, family }]);
      else callback(null, request.address, family);
    },
  };
  return new Promise((resolve, reject) => {
    const onResponse = (incoming: IncomingMessage): void => collectBody(incoming, request.maxResponseBytes, resolve, reject);
    const outgoing =
      request.url.protocol === 'https:'
        ? requestHttps(request.url, options, onResponse)
        : requestHttp(request.url, options, onResponse);
    outgoing.on('error', reject);
    if (request.body === undefined) outgoing.end();
    else outgoing.end(request.body);
  });
}

type PinnedCallback = (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

function collectBody(
  incoming: IncomingMessage,
  maxBytes: number,
  resolve: (response: HttpResponse) => void,
  reject: (error: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;

  const finish = (truncated: boolean): void => {
    if (settled) return;
    settled = true;
    resolve({
      status: incoming.statusCode ?? 0,
      statusText: incoming.statusMessage ?? '',
      contentType: incoming.headers['content-type'],
      body: Buffer.concat(chunks).toString('utf8'),
      truncated,
    });
  };

  incoming.on('data', (chunk: Buffer) => {
    if (settled) return;
    const room = maxBytes - size;
    if (chunk.length > room) {
      chunks.push(chunk.subarray(0, room));
      size = maxBytes;
      finish(true);
      incoming.destroy();
      return;
    }
    chunks.push(chunk);
    size += chunk.length;
  });
  incoming.on('end', () => finish(false));
  incoming.on('close', () => finish(false));
  incoming.on('error', (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  });
}
