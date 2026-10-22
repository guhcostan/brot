import type { McpServer } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { McpServerDialog, type McpServerDialogProps } from './McpServerDialog';

const at = '2026-10-19T09:00:00.000Z';

const stdioServer: McpServer = {
  id: 'mcp_1',
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
  env: { MCP_LOG_LEVEL: 'info', GITHUB_TOKEN: 'secret://github_token' },
  enabled: true,
  createdAt: at,
  updatedAt: at,
};

const httpServer: McpServer = {
  id: 'mcp_2',
  name: 'search',
  transport: 'http',
  args: [],
  env: {},
  url: 'https://mcp.example.com/search',
  enabled: false,
  createdAt: at,
  updatedAt: at,
};

const noop = async () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<McpServerDialogProps> = {}): string {
  const props: McpServerDialogProps = {
    open: true,
    onClose: () => undefined,
    onCreate: noop,
    onUpdate: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<McpServerDialog {...props} />);
}

describe('MCP server dialog', () => {
  it('offers the stdio fields by default for a new server', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.mcpDialogNew'));
    expect(text).toContain(t('settings.mcpName'));
    expect(text).toContain(t('settings.mcpTransport'));
    expect(text).toContain(t('settings.mcpTransportStdio'));
    expect(text).toContain(t('settings.mcpTransportHttp'));
    expect(text).toContain(t('settings.mcpCommand'));
    expect(text).toContain(t('settings.mcpArgsHint'));
    expect(text).toContain(t('settings.mcpEnv'));
    expect(text).toContain(t('settings.mcpEnvHint'));
    expect(text).toContain(t('settings.mcpEnvAdd'));
    expect(text).toContain(t('settings.mcpEnabled'));
    expect(text).toContain(t('settings.mcpCreate'));
    expect(text).not.toContain(t('settings.mcpUrl'));
  });

  it('prefills a stdio edit, including env secret references', () => {
    const html = render({ server: stdioServer });
    const text = textOf(html);

    expect(text).toContain(t('settings.mcpDialogEdit'));
    expect(html).toContain('value="filesystem"');
    expect(html).toContain('value="npx"');
    expect(text).toContain('-y');
    expect(text).toContain('@modelcontextprotocol/server-filesystem');
    expect(html).toContain('value="MCP_LOG_LEVEL"');
    expect(html).toContain('value="secret://github_token"');
    expect(text).toContain(t('settings.mcpSave'));
  });

  it('shows the URL field for an http edit and no stdio fields', () => {
    const html = render({ server: httpServer });
    const text = textOf(html);

    expect(text).toContain(t('settings.mcpUrl'));
    expect(html).toContain('value="https://mcp.example.com/search"');
    expect(text).not.toContain(t('settings.mcpCommand'));
    expect(text).not.toContain(t('settings.mcpEnvHint'));
  });
});
