import { t } from '../i18n';

/** The tool name without an MCP server prefix ("mcp__brot__browser_open" → "browser_open"). */
export function baseTool(tool: string): string {
  return tool.split(/__|\./).at(-1) ?? tool;
}

function hostOf(url: unknown): string | undefined {
  if (typeof url !== 'string' || url === '') return undefined;
  try {
    return new URL(url).host || url;
  } catch {
    return url.length > 40 ? `${url.slice(0, 39)}…` : url;
  }
}

/** One short line saying what the bot is doing on its desktop, from its last browser tool call. */
export function describeActivity(tool: string, args: Record<string, unknown>): string {
  const name = baseTool(tool);
  switch (name) {
    case 'browser_open':
      return t('computer.activity.open', { target: hostOf(args.url) ?? '…' });
    case 'browser_snapshot':
      return t('computer.activity.snapshot');
    case 'browser_click':
      return t('computer.activity.click');
    case 'browser_type':
      return t('computer.activity.type');
    case 'browser_key':
      return t('computer.activity.key', { key: typeof args.key === 'string' ? args.key : '…' });
    case 'browser_scroll':
      return t('computer.activity.scroll');
    case 'browser_back':
      return t('computer.activity.back');
    case 'computer_screenshot':
      return t('computer.activity.screenshot');
    case 'request_takeover':
      return t('computer.activity.takeover');
    default:
      return t('computer.activity.other', { tool: name });
  }
}
