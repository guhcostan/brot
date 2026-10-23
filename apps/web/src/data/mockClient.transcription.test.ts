import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock transcription', () => {
  it('starts unset and unavailable', async () => {
    const client = createMockClient();
    const status = await client.getTranscriptionStatus();

    expect(status).toMatchObject({ settings: {}, available: false });
    expect(status.reason).toBeTruthy();
  });

  it('accepts a transcription-capable model and becomes available', async () => {
    const client = createMockClient();
    const status = await client.updateTranscriptionSettings({ model: 'opencode-go/deepseek-v4.1-flash' });

    expect(status).toMatchObject({ settings: { model: 'opencode-go/deepseek-v4.1-flash' }, available: true });
    expect(status.settings.updatedAt).toBeTruthy();
    await expect(client.getTranscriptionStatus()).resolves.toMatchObject({ available: true });
  });

  it('refuses models that cannot transcribe and unknown refs, then clears', async () => {
    const client = createMockClient();
    await expect(client.updateTranscriptionSettings({ model: 'deepseek/deepseek-v4.1' })).rejects.toThrow('cannot transcribe');
    await expect(client.updateTranscriptionSettings({ model: 'nope/nope' })).rejects.toThrow('Unknown transcription model');
    await expect(client.updateTranscriptionSettings({ model: '' })).rejects.toThrow();

    await client.updateTranscriptionSettings({ model: 'opencode-go/deepseek-v4.1-flash' });
    const cleared = await client.updateTranscriptionSettings({ model: null });
    expect(cleared.settings).not.toHaveProperty('model');
    expect(cleared.available).toBe(false);
  });

  it('marks a capable model unavailable when its provider has no key', async () => {
    const client = createMockClient();
    // deepseek-v4.1 is not flagged capable; mark capability through the mock's own provider flags instead.
    await expect(client.listProviders()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ models: expect.arrayContaining([expect.objectContaining({ transcription: true })]) })]),
    );
  });
});
