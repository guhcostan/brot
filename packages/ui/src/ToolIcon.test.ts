import { describe, expect, it } from 'vitest';
import { toolKind } from './ToolIcon';

describe('toolKind', () => {
  it('reads Brot MCP browser tools and dotted connector names', () => {
    expect(toolKind('browser_open')).toBe('open');
    expect(toolKind('browser.open')).toBe('open');
    expect(toolKind('browser_snapshot')).toBe('snapshot');
    expect(toolKind('browser_click')).toBe('click');
    expect(toolKind('browser_type')).toBe('type');
    expect(toolKind('computer_screenshot')).toBe('screenshot');
    expect(toolKind('request_takeover')).toBe('takeover');
  });

  it('groups common tools', () => {
    expect(toolKind('shell')).toBe('shell');
    expect(toolKind('http_request')).toBe('http');
    expect(toolKind('gmail.send')).toBe('mail');
    expect(toolKind('calendar.list_events')).toBe('calendar');
    expect(toolKind('docs.search')).toBe('search');
    expect(toolKind('delegate_task')).toBe('team');
    expect(toolKind('something_new')).toBe('other');
  });
});
