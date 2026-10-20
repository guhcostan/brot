import { toolKind, type ToolKind, type ToolStep, type ToolTimelineLabels } from '@brot/ui';
import { summarizeArgs } from '../format';
import { t, type TranslationKey } from '../i18n';
import type { ToolItem } from '../state/thread';

const KIND_TITLE: Record<ToolKind, TranslationKey> = {
  open: 'tool.kind.open',
  snapshot: 'tool.kind.snapshot',
  click: 'tool.kind.click',
  type: 'tool.kind.type',
  key: 'tool.kind.key',
  scroll: 'tool.kind.scroll',
  back: 'tool.kind.back',
  tabs: 'tool.kind.tabs',
  screenshot: 'tool.kind.screenshot',
  takeover: 'tool.kind.takeover',
  shell: 'tool.kind.shell',
  http: 'tool.kind.http',
  file: 'tool.kind.file',
  mail: 'tool.kind.mail',
  calendar: 'tool.kind.calendar',
  search: 'tool.kind.search',
  memory: 'tool.kind.memory',
  team: 'tool.kind.team',
  other: 'tool.kind.other',
};

const ACTION: Record<ToolKind, TranslationKey> = {
  open: 'computer.action.open',
  snapshot: 'computer.action.snapshot',
  click: 'computer.action.click',
  type: 'computer.action.type',
  key: 'computer.action.key',
  scroll: 'computer.action.scroll',
  back: 'computer.action.back',
  tabs: 'computer.action.tabs',
  screenshot: 'computer.action.screenshot',
  takeover: 'computer.action.takeover',
  shell: 'computer.action.other',
  http: 'computer.action.other',
  file: 'computer.action.other',
  mail: 'computer.action.other',
  calendar: 'computer.action.other',
  search: 'computer.action.other',
  memory: 'computer.action.other',
  team: 'computer.action.other',
  other: 'computer.action.other',
};

const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** A URL without the scheme and the trailing slash: "news.ycombinator.com/item?id=1". */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/** The one-line gloss shown next to a step: the URL, the ref, the key or the command. */
export function stepSummary(tool: string, args: Record<string, unknown>): string {
  switch (toolKind(tool)) {
    case 'open':
      return args.url ? shortUrl(str(args.url)) : summarizeArgs(args);
    case 'click':
      return args.ref !== undefined ? t('tool.ref', { ref: str(args.ref) }) : '';
    case 'type':
      return args.text ? `"${str(args.text).slice(0, 40)}"` : '';
    case 'key':
      return str(args.key);
    case 'scroll':
      return str(args.direction);
    case 'takeover':
      return str(args.reason);
    default:
      return summarizeArgs(args);
  }
}

export function toStep(item: ToolItem): ToolStep {
  return {
    id: item.callId,
    tool: item.tool,
    status: item.status,
    title: t(KIND_TITLE[toolKind(item.tool)]),
    summary: stepSummary(item.tool, item.args) || undefined,
    args: item.args,
    ...(item.output === undefined ? {} : { output: item.output }),
  };
}

/** What the bot is doing on its computer, for the live screen's status line. */
export function describeAction(item: ToolItem): string {
  const kind = toolKind(item.tool);
  const target = stepSummary(item.tool, item.args);
  return t(ACTION[kind], { target, tool: item.tool });
}

export function timelineLabels(): Partial<ToolTimelineLabels> {
  return {
    steps: (count) => (count === 1 ? t('tool.steps.one') : t('tool.steps.many', { count: String(count) })),
    status: { running: t('tool.status.running'), ok: t('tool.status.ok'), error: t('tool.status.error') },
    details: t('tool.details'),
    noOutput: t('tool.noOutput'),
  };
}
