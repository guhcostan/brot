import { describe, expect, it } from 'vitest';
import { createSseParser, createXhrStream, type SseFrame, type XhrLike } from './sse';

function collect() {
  const frames: SseFrame[] = [];
  return { frames, parser: createSseParser((frame) => frames.push(frame)) };
}

describe('createSseParser', () => {
  it('parses named events with ids', () => {
    const { frames, parser } = collect();
    parser.push('id: e1\nevent: run.started\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ event: 'run.started', data: '{"a":1}', id: 'e1' }]);
  });

  it('handles chunks split anywhere, including inside CRLF', () => {
    const { frames, parser } = collect();
    const text = 'event: x\r\ndata: one\r\ndata: two\r\n\r\n';
    for (const char of text) parser.push(char);
    expect(frames).toEqual([{ event: 'x', data: 'one\ntwo' }]);
  });

  it('ignores comments such as keep-alives and frames without data', () => {
    const { frames, parser } = collect();
    parser.push(': keep-alive\n\nevent: lonely\n\ndata: ok\n\n');
    expect(frames).toEqual([{ event: 'message', data: 'ok' }]);
  });

  it('keeps an incomplete frame until its blank line arrives', () => {
    const { frames, parser } = collect();
    parser.push('data: par');
    expect(frames).toHaveLength(0);
    parser.push('tial\n\n');
    expect(frames[0]?.data).toBe('partial');
  });
});

class FakeXhr implements XhrLike {
  static last: FakeXhr | undefined;
  readyState = 0;
  status = 0;
  responseText = '';
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;
  headers: Record<string, string> = {};
  url = '';
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {}
  abort() {
    this.aborted = true;
  }
  emit(readyState: number, status: number, append = '') {
    this.readyState = readyState;
    this.status = status;
    this.responseText += append;
    this.onreadystatechange?.();
  }
}

describe('createXhrStream', () => {
  it('streams frames from partial responseText and reports the close status', () => {
    const frames: string[] = [];
    const closes: number[] = [];
    let opened = 0;
    const open = createXhrStream(FakeXhr);
    open(
      { url: 'http://h/api/events', headers: { Authorization: 'Bearer t' } },
      { onOpen: () => (opened += 1), onFrame: (f) => frames.push(f.data), onClose: (s) => closes.push(s) },
    );
    const xhr = FakeXhr.last!;
    expect(xhr.headers.Authorization).toBe('Bearer t');
    xhr.emit(2, 200);
    xhr.emit(3, 200, 'data: a\n\nda');
    xhr.emit(3, 200, 'ta: b\n\n');
    xhr.emit(4, 200);
    expect(opened).toBe(1);
    expect(frames).toEqual(['a', 'b']);
    expect(closes).toEqual([200]);
  });

  it('does not parse error bodies and reports their status', () => {
    const frames: string[] = [];
    const closes: number[] = [];
    createXhrStream(FakeXhr)(
      { url: 'u', headers: {} },
      { onOpen: () => undefined, onFrame: (f) => frames.push(f.data), onClose: (s) => closes.push(s) },
    );
    FakeXhr.last!.emit(4, 401, 'data: nope\n\n');
    expect(frames).toEqual([]);
    expect(closes).toEqual([401]);
  });

  it('stays silent after close', () => {
    const closes: number[] = [];
    const conn = createXhrStream(FakeXhr)(
      { url: 'u', headers: {} },
      { onOpen: () => undefined, onFrame: () => undefined, onClose: (s) => closes.push(s) },
    );
    conn.close();
    expect(FakeXhr.last!.aborted).toBe(true);
    expect(closes).toEqual([]);
  });
});
