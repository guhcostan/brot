import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'MCP bot', job: 'Researcher', computer: 'none' as const };

describe('mock bot MCP grants', () => {
  it('persists an allowlist through create and update, keeping its order', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, mcpServerIds: ['mcp_search', 'mcp_filesystem'] });
    expect(created.mcpServerIds).toEqual(['mcp_search', 'mcp_filesystem']);

    const listed = (await client.listBots()).find((bot) => bot.id === created.id);
    expect(listed?.mcpServerIds).toEqual(['mcp_search', 'mcp_filesystem']);

    const edited = await client.updateBot(created.id, { mcpServerIds: ['mcp_filesystem'] });
    expect(edited.mcpServerIds).toEqual(['mcp_filesystem']);
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.mcpServerIds).toEqual(['mcp_filesystem']);
  });

  it('keeps an empty allowlist as "no servers" instead of every server', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, mcpServerIds: [] });

    expect(created.mcpServerIds).toEqual([]);
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.mcpServerIds).toEqual([]);
  });

  it('omits the field for the default (every enabled server) and clears back to it', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);
    expect(created.mcpServerIds).toBeUndefined();

    await client.updateBot(created.id, { mcpServerIds: ['mcp_filesystem'] });
    const cleared = await client.updateBot(created.id, { mcpServerIds: null });
    expect(cleared.mcpServerIds).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.mcpServerIds).toBeUndefined();
  });

  it('refuses unknown server ids and leaves the previous grants alone', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, mcpServerIds: ['mcp_filesystem'] });

    await expect(client.updateBot(created.id, { mcpServerIds: ['mcp_missing'] })).rejects.toThrow('Unknown MCP server');
    await expect(client.createBot({ ...base, name: 'Other', mcpServerIds: ['mcp_missing'] })).rejects.toThrow('Unknown MCP server');
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.mcpServerIds).toEqual(['mcp_filesystem']);
  });

  it('does not change grants through unrelated patches', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, mcpServerIds: ['mcp_search'] });

    const renamed = await client.updateBot(created.id, { name: 'Renamed' });
    expect(renamed.mcpServerIds).toEqual(['mcp_search']);
  });
});
