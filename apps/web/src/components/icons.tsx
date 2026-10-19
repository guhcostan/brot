import type { ReactElement, ReactNode } from 'react';

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
