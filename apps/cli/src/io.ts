export interface Writer {
  write(chunk: string): unknown;
}

export function writeJsonLine(writer: Writer, value: unknown): void {
  writer.write(`${JSON.stringify(value)}\n`);
}

export function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}
