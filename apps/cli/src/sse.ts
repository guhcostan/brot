export interface SseMessage {
  event?: string;
  id?: string;
  data: string;
}

/** Parses a text/event-stream body. Comment lines (keep-alives) and events without data are skipped. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let end = pending.indexOf('\n');
      while (end !== -1) {
        const line = pending.slice(0, end).replace(/\r$/, '');
        pending = pending.slice(end + 1);
        end = pending.indexOf('\n');
        if (line === '') {
          if (data.length > 0) yield { event, id, data: data.join('\n') };
          event = undefined;
          id = undefined;
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'id') id = value;
        else if (field === 'data') data.push(value);
      }
      if (chunk.done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
