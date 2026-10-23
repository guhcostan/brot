import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_SEND } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock cancelRun', () => {
  it('accepts a run id the mock history knows', async () => {
    const client = createMockClient();
    await expect(client.cancelRun(PENDING_SEND.runId)).resolves.toBeUndefined();
  });

  it('rejects an unknown run id', async () => {
    const client = createMockClient();
    await expect(client.cancelRun('run_missing')).rejects.toThrow('Unknown run');
  });
});
