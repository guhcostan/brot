import type { Approval, Bot, CanonicalEvent, Message } from '@brot/protocol';

export const T0 = '2026-10-19T12:00:00.000Z';

export function at(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

export function bot(patch: Partial<Bot> & { id: string }): Bot {
  return {
    name: patch.id,
    job: 'Helps',
    instructions: '',
    engine: 'mock',
    computer: 'none',
    pinned: false,
    archived: false,
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  };
}

export function message(patch: Partial<Message> & { id: string }): Message {
  return { threadId: 'th1', role: 'assistant', content: 'hi', createdAt: T0, ...patch };
}

export function approval(patch: Partial<Approval> & { id: string }): Approval {
  return {
    runId: 'r1',
    threadId: 'th1',
    botId: 'b1',
    kind: 'send',
    tool: 'email.send',
    summary: 'Send the email?',
    args: {},
    status: 'pending',
    createdAt: T0,
    ...patch,
  };
}

type Distribute<T> = T extends unknown ? Omit<T, 'id' | 'at' | 'threadId'> & Partial<Pick<CanonicalEvent, 'id' | 'at' | 'threadId'>> : never;

let counter = 0;
export function event(input: Distribute<CanonicalEvent>): CanonicalEvent {
  counter += 1;
  return { id: `ev${counter}`, at: at(counter), threadId: 'th1', ...input } as CanonicalEvent;
}

/** A fetch double that records calls and answers from a route table keyed by "METHOD /path". */
export function fakeFetch(routes: Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { pathname, search } = new URL(url);
    const key = `${init?.method ?? 'GET'} ${pathname}${search}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return handler(init);
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => void map.set(key, value),
    deleteItem: async (key: string) => void map.delete(key),
  };
}

/** Headers of a recorded fetch call, empty when the call or its headers are missing. */
export function headersOf(call: { init?: RequestInit } | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>;
}
