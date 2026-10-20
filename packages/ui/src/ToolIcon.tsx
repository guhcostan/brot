import type { ReactElement, ReactNode } from 'react';

export const TOOL_KINDS = [
  'open',
  'snapshot',
  'click',
  'type',
  'key',
  'scroll',
  'back',
  'tabs',
  'screenshot',
  'takeover',
  'shell',
  'http',
  'file',
  'mail',
  'calendar',
  'search',
  'memory',
  'team',
  'other',
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/**
 * Groups a tool name into a kind for its icon and label. Accepts both Brot MCP names
 * (`browser_open`) and dotted connector names (`gmail.send`, `browser.open`).
 */
export function toolKind(tool: string): ToolKind {
  const name = tool.toLowerCase();
  const verb = name.split(/[._]/).at(-1) ?? name;
  if (name.startsWith('browser') || name.startsWith('computer')) {
    if (verb === 'open' || verb === 'navigate' || verb === 'goto') return 'open';
    if (verb === 'snapshot') return 'snapshot';
    if (verb === 'click') return 'click';
    if (verb === 'type' || verb === 'fill') return 'type';
    if (verb === 'key' || verb === 'press') return 'key';
    if (verb === 'scroll') return 'scroll';
    if (verb === 'back') return 'back';
    if (verb === 'tabs') return 'tabs';
    if (verb === 'screenshot') return 'screenshot';
    return 'open';
  }
  if (name === 'request_takeover' || name.includes('takeover')) return 'takeover';
  if (/^(shell|bash|exec|run_command|terminal)/.test(name)) return 'shell';
  if (/^(http|fetch|web_fetch|curl)/.test(name)) return 'http';
  if (/(^|[._])(read|write|edit|file|fs)([._]|$)/.test(name)) return 'file';
  if (/^(gmail|mail|email|outlook)/.test(name)) return 'mail';
  if (/^(calendar|gcal)/.test(name)) return 'calendar';
  if (/(search|docs|grep|find)/.test(name)) return 'search';
  if (/memory|remember/.test(name)) return 'memory';
  if (/^(ask_bot|delegate_task|handoff)/.test(name)) return 'team';
  return 'other';
}

const GLYPHS: Record<ToolKind, ReactNode> = {
  open: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="m12.6 7.4-1.6 3.6-3.6 1.6 1.6-3.6z" />
    </>
  ),
  snapshot: (
    <>
      <path d="M3 10s2.6-4.75 7-4.75S17 10 17 10s-2.6 4.75-7 4.75S3 10 3 10Z" />
      <circle cx="10" cy="10" r="2" />
    </>
  ),
  click: (
    <>
      <path d="m7 6 8 3.2-3.4 1.2L10.4 14z" />
      <path d="M5 3.5 5.8 5M3 6.5l1.5.6M8.5 2.8v1.6" />
    </>
  ),
  type: (
    <>
      <rect x="2.75" y="5.75" width="14.5" height="8.5" rx="2" />
      <path d="M5.5 8.5h.01M8 8.5h.01M10.5 8.5h.01M13 8.5h.01M6.5 11.5h7" />
    </>
  ),
  key: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="3" />
      <path d="M12.5 8v2.5h-5m1.5-1.5-1.5 1.5L9 12" />
    </>
  ),
  scroll: (
    <>
      <path d="M10 3.5v13M6.5 7 10 3.5 13.5 7M6.5 13 10 16.5 13.5 13" />
    </>
  ),
  back: <path d="M15.5 10h-11M8.5 6l-4 4 4 4" />,
  tabs: (
    <>
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M5 6V4.75A1.75 1.75 0 0 1 6.75 3h6.5A1.75 1.75 0 0 1 15 4.75V6" />
    </>
  ),
  screenshot: (
    <>
      <path d="M3 7.25A1.75 1.75 0 0 1 4.75 5.5h1.5L7.5 4h5l1.25 1.5h1.5A1.75 1.75 0 0 1 17 7.25v6.5a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 13.75z" />
      <circle cx="10" cy="10.5" r="2.5" />
    </>
  ),
  takeover: (
    <>
      <path d="M7 10.5V5.25a1.25 1.25 0 0 1 2.5 0V9.5m0-1.25V4.25a1.25 1.25 0 0 1 2.5 0V9.5m0-3.25a1.25 1.25 0 0 1 2.5 0v5.25A5.25 5.25 0 0 1 9.25 16.75 4.5 4.5 0 0 1 5.4 14.6L3.9 12a1.2 1.2 0 0 1 2-1.35L7 12" />
    </>
  ),
  shell: (
    <>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <path d="m6 8 2.5 2L6 12M10.5 12.5H14" />
    </>
  ),
  http: (
    <>
      <path d="M4 7.5h11.5M12.5 4.5l3 3-3 3M16 12.5H4.5M7.5 9.5l-3 3 3 3" />
    </>
  ),
  file: (
    <>
      <path d="M11.5 2.75H6A1.75 1.75 0 0 0 4.25 4.5v11A1.75 1.75 0 0 0 6 17.25h8a1.75 1.75 0 0 0 1.75-1.75V7z" />
      <path d="M11.5 2.75V7h4.25M7.5 11h5M7.5 14h3.5" />
    </>
  ),
  mail: (
    <>
      <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="2" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.25" width="14" height="12.5" rx="2" />
      <path d="M3 8h14M7 2.75v3M13 2.75v3" />
    </>
  ),
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5" />
      <path d="m12.5 12.5 4 4" />
    </>
  ),
  memory: <path d="M6 3.25h8a.75.75 0 0 1 .75.75v12.6a.4.4 0 0 1-.64.32L10 13.75 5.89 16.92a.4.4 0 0 1-.64-.32V4A.75.75 0 0 1 6 3.25Z" />,
  team: (
    <>
      <circle cx="7.25" cy="7.5" r="2.5" />
      <circle cx="13.5" cy="8.5" r="2" />
      <path d="M2.75 15.5a4.5 4.5 0 0 1 9 0M12 15.5h5a3.5 3.5 0 0 0-5.4-2.95" />
    </>
  ),
  other: <path d="M12.25 3.25a3.5 3.5 0 0 0-3.4 4.3L3.6 12.8a1.6 1.6 0 0 0 2.27 2.27l5.25-5.25a3.5 3.5 0 0 0 4.3-3.4l-2 .9-1.75-1.75z" />,
};

export interface ToolIconProps {
  kind: ToolKind;
  size?: number;
  className?: string;
}

/** A line glyph for a kind of tool call, drawn in currentColor. */
export function ToolIcon({ kind, size = 16, className }: ToolIconProps): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-tool-kind={kind}
    >
      {GLYPHS[kind]}
    </svg>
  );
}
