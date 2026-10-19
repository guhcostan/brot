/** One dispatched server-sent event. `event` defaults to "message" per the SSE spec. */
export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  push(chunk: string): void;
}

/**
 * Incremental parser for the text/event-stream format (WHATWG HTML, "Server-sent events").
 * Chunks may split lines anywhere; lines end in LF, CR, or CRLF; comment lines start with ":".
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let id: string | undefined;
  let pendingCr = false;

  const dispatch = () => {
    if (data.length > 0) {
      const frame: SseFrame = { event: event || 'message', data: data.join('\n') };
      if (id !== undefined) frame.id = id;
      onFrame(frame);
    }
    data = [];
    event = '';
  };

  const line = (text: string) => {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
  };

  return {
    push(chunk) {
      let text = chunk;
      if (pendingCr && text.startsWith('\n')) text = text.slice(1);
      pendingCr = false;
      buffer += text;
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        // A trailing CR may be the first half of a CRLF split across chunks.
        if (match[0] === '\r' && match.index === buffer.length - 1) pendingCr = true;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
  };
}

export interface StreamHandlers {
  onOpen(): void;
  onFrame(frame: SseFrame): void;
  /** The stream ended. `status` is the HTTP status, or 0 when the connection failed before one arrived. */
  onClose(status: number): void;
}

export interface StreamConnection {
  close(): void;
}

export type OpenStream = (request: { url: string; headers: Record<string, string> }, handlers: StreamHandlers) => StreamConnection;

const MAX_RESPONSE_CHARS = 2_000_000;

/** Constructor shape of XMLHttpRequest that this transport uses. */
export interface XhrLike {
  readyState: number;
  status: number;
  responseText: string;
  onreadystatechange: (() => void) | null;
  onprogress: (() => void) | null;
  onerror: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
}

/**
 * React Native has no EventSource, and its fetch does not stream bodies. XMLHttpRequest does expose
 * partial `responseText` while loading, and unlike EventSource it can send the Authorization header.
 */
export function createXhrStream(Xhr: new () => XhrLike = XMLHttpRequest as unknown as new () => XhrLike): OpenStream {
  return ({ url, headers }, handlers) => {
    const xhr = new Xhr();
    const parser = createSseParser(handlers.onFrame);
    let read = 0;
    let opened = false;
    let done = false;

    const drain = () => {
      if (xhr.status !== 200) return;
      const text = xhr.responseText;
      if (text.length > read) {
        parser.push(text.slice(read));
        read = text.length;
      }
      // responseText keeps the whole body, so a long-lived stream is recycled; the caller resumes it.
      if (read > MAX_RESPONSE_CHARS && !done) {
        detach();
        xhr.abort();
        finish(200);
      }
    };
    const detach = () => {
      xhr.onreadystatechange = null;
      xhr.onprogress = null;
      xhr.onerror = null;
    };
    const finish = (status: number) => {
      if (done) return;
      done = true;
      handlers.onClose(status);
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && !opened && xhr.status === 200) {
        opened = true;
        handlers.onOpen();
      }
      if (xhr.readyState >= 3) drain();
      if (xhr.readyState === 4) finish(xhr.status);
    };
    xhr.onprogress = drain;
    xhr.onerror = () => finish(0);
    xhr.open('GET', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.send();

    return {
      close() {
        done = true;
        detach();
        xhr.abort();
      },
    };
  };
}
