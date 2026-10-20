import { describe, expect, it } from 'vitest';
import { baseTool, describeActivity } from './activity';

describe('computer activity line', () => {
  it('strips MCP prefixes', () => {
    expect(baseTool('mcp__brot__browser_open')).toBe('browser_open');
    expect(baseTool('browser_click')).toBe('browser_click');
  });

  it('describes browser tools in plain words', () => {
    expect(describeActivity('mcp__brot__browser_open', { url: 'https://shop.example.com/cart' })).toBe('Opening shop.example.com');
    expect(describeActivity('browser_key', { key: 'Enter' })).toBe('Pressing Enter');
    expect(describeActivity('request_takeover', { reason: 'Sign in' })).toBe('Asking for your help');
    expect(describeActivity('browser_zoom', {})).toBe('Using browser_zoom');
  });
});
