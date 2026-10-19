import type { FetchLike } from './client';

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export type Route = (request: RecordedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** Routes keyed by `METHOD /pathname`. Every request is recorded, and an unknown route answers 500 so tests fail loudly. */
export function fakeFetch(routes: Record<string, Route>): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const request: RecordedRequest = {
      method,
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return json({ error: `no fake route for ${method} ${url.pathname}` }, 500);
    return route(request, init?.signal ?? undefined);
  };
  return { fetch, requests };
}

export const unreachable: FetchLike = async () => {
  throw new TypeError('fetch failed');
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function sse(events: Array<{ type: string }>): Response {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

export function capture(): { write(chunk: string): boolean; text(): string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join(''),
  };
}
