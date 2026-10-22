import type { ReactElement, ReactNode } from 'react';
import { cx } from '@brot/ui';

function Icon({ size = 18, children }: { size?: number; children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12.5 4.5 7 10l5.5 5.5" />
  </Icon>
);

/** Points right; CSS rotates it a quarter turn when a row is expanded. */
export const ChevronRight = ({ size, className }: { size?: number; className?: string }) => (
  <span className={cx('inline-flex', className)}>
    <Icon size={size}>
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
    </Icon>
  </span>
);

export const Plus = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const Close = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

/** A checklist: the task board. */
export const Board = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m3.5 5.5 1.5 1.5 2.5-3M3.5 12.5l1.5 1.5 2.5-3" />
    <path d="M10.5 5.5h6M10.5 12.5h6" />
  </Icon>
);

/** A relay baton passing hands. */
export const Baton = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="m5 15 9.5-9.5" strokeWidth="2.5" />
    <path d="M3 12.5 7.5 17M12.5 3 17 7.5" />
  </Icon>
);

export const ArrowRight = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 10h11M11 6l4 4-4 4" />
  </Icon>
);

/** A speaker: read this reply aloud. */
export const Speaker = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 8.25h2.75L10.5 5v10L6.75 11.75H4z" />
    <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.25 5.5a6.5 6.5 0 0 1 0 9" />
  </Icon>
);

/** A muted speaker: stop reading aloud. */
export const SpeakerOff = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 8.25h2.75L10.5 5v10L6.75 11.75H4z" />
    <path d="m13.5 8 4 4M17.5 8l-4 4" />
  </Icon>
);

/** A down arrow into a tray: download a file. */
export const Download = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 3.5v8M6.5 8 10 11.5 13.5 8" />
    <path d="M4 13.5v1.75a1.25 1.25 0 0 0 1.25 1.25h9.5A1.25 1.25 0 0 0 16 15.25V13.5" />
  </Icon>
);

/** Three dots: the overflow menu. */
export const More = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="4.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);

/** A paperclip: attach files to a message. */
export const Paperclip = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M13.9 8.6 9 13.5a2.5 2.5 0 0 1-3.5-3.5l5.6-5.6a1.75 1.75 0 0 1 2.5 2.5l-5.6 5.6a1 1 0 0 1-1.4-1.4l4.9-4.9" />
  </Icon>
);

/** A sheet of paper with a folded corner: a non-image attachment. */
export const FileDoc = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5.5 3.25h5.75L15 7.5v9.25H5.5z" />
    <path d="M11.25 3.25V7.5H15" />
  </Icon>
);

/** Three bars: the insights page. */
export const Chart = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 16.25V10M10 16.25V4.25M16 16.25V7.5" />
  </Icon>
);

/** A bell: the notification inbox. */
export const Bell = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5.5 8.25a4.5 4.5 0 0 1 9 0c0 3.1.9 4.35 1.5 5H4c.6-.65 1.5-1.9 1.5-5Z" />
    <path d="M8.25 16a1.75 1.75 0 0 0 3.5 0" />
    <path d="M10 2.75v1" />
  </Icon>
);

/** A clock: routines and scheduled runs. */
export const Clock = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M10 6v4.25l2.75 1.75" />
  </Icon>
);

export const Gear = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.75v1.9M10 15.35v1.9M17.25 10h-1.9M4.65 10h-1.9M15.13 4.87l-1.35 1.35M6.22 13.78l-1.35 1.35M15.13 15.13l-1.35-1.35M6.22 6.22 4.87 4.87" />
  </Icon>
);

/** A tray: the approvals inbox. */
export const Inbox = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 11.5 5 4.75h10l2 6.75v3.75a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M3 11.5h4l1 2h4l1-2h4" />
  </Icon>
);

export const Pencil = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m12.5 4.5 3 3-8.25 8.25-3.75.75.75-3.75z" />
  </Icon>
);

export const Archive = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="4" width="14" height="3.5" rx="1" />
    <path d="M4.25 7.5v7.75a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V7.5M8.25 10.5h3.5" />
  </Icon>
);

export const Trash = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.75 10.75h7.5l.75-10.75" />
  </Icon>
);

export const Expand = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5 11 9M3.5 16.5 9 11" />
  </Icon>
);

export const Hand = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M7 10.5V5.25a1.25 1.25 0 0 1 2.5 0V9.5m0-1.25V4.25a1.25 1.25 0 0 1 2.5 0V9.5m0-3.25a1.25 1.25 0 0 1 2.5 0v5.25A5.25 5.25 0 0 1 9.25 16.75 4.5 4.5 0 0 1 5.4 14.6L3.9 12a1.2 1.2 0 0 1 2-1.35L7 12" />
  </Icon>
);

export const Play = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6.5 4.5v11l9-5.5z" />
  </Icon>
);

export const Monitor = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="2.75" y="3.75" width="14.5" height="10" rx="1.75" />
    <path d="M7 16.75h6M10 13.75v3" />
  </Icon>
);

export const Check = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const Phone = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="2" />
    <path d="M9 14.5h2" />
  </Icon>
);

export const Sparkle = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 3.5c.5 3.2 1.8 4.5 5 5-3.2.5-4.5 1.8-5 5-.5-3.2-1.8-4.5-5-5 3.2-.5 4.5-1.8 5-5Z" />
  </Icon>
);
