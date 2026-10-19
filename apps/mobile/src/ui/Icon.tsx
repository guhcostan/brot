import type { ColorToken } from '@brot/ui/tokens';
import type { ReactElement } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/** Line icons on a 24-unit grid, 1.75 stroke with round caps, so they sit with Inter at any size. */
const PATHS = {
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  sliders: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
  scan: ['M4 8V6a2 2 0 0 1 2-2h2', 'M16 4h2a2 2 0 0 1 2 2v2', 'M20 16v2a2 2 0 0 1-2 2h-2', 'M8 20H6a2 2 0 0 1-2-2v-2', 'M7 12h10'],
  keyboard: ['M4 7h16v10H4z', 'M8 11h.01', 'M12 11h.01', 'M16 11h.01', 'M8 14h8'],
  alert: ['M12 8v5', 'M12 16.5h.01', 'M10.3 4.3L2.9 17.2A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0z'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12v9H6z'],
  wifiOff: ['M2 2l20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M5 12.9a10 10 0 0 1 5.2-2.7', 'M19 12.9a10 10 0 0 0-2-1.4', 'M12 20h.01'],
} as const;

export type IconName = keyof typeof PATHS | 'stop';

export interface IconProps {
  name: IconName;
  size?: number;
  tone?: ColorToken;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, tone = 'ink', strokeWidth = 1.75 }: IconProps): ReactElement {
  const theme = useTheme();
  const color = theme.color[tone];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
      {name === 'stop' ? (
        <Rect x={7} y={7} width={10} height={10} rx={2} fill={color} />
      ) : (
        PATHS[name].map((d) => (
          <Path key={d} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))
      )}
    </Svg>
  );
}
