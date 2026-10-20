import { DESKTOP_HEIGHT, DESKTOP_WIDTH, type ComputerInput, type ComputerState, type Takeover } from '@brot/protocol';

/** What the fake desktop shows: a blank tab, a sign-in form, a feed, or search results. */
export type FakePage = 'blank' | 'signin' | 'feed' | 'search' | 'article';

export interface FakeScreen {
  state: ComputerState;
  desktop: boolean;
  takeover: Takeover | null;
  url: string;
  title: string;
  page: FakePage;
  cursor: { x: number; y: number };
  /** The last click, drawn as a fading ring for a moment. */
  click?: { x: number; y: number; at: number };
  /** Which sign-in field has focus, and what was typed into each. */
  field: 'email' | 'password' | null;
  email: string;
  password: string;
  scroll: number;
  signedIn: boolean;
}

export function newScreen(state: ComputerState, desktop: boolean): FakeScreen {
  return {
    state,
    desktop,
    takeover: null,
    url: 'about:blank',
    title: 'New tab',
    page: 'blank',
    cursor: { x: 640, y: 420 },
    field: null,
    email: '',
    password: '',
    scroll: 0,
    signedIn: false,
  };
}

/** Moves the fake browser to a URL and picks a page layout for it. */
export function navigate(screen: FakeScreen, url: string): void {
  const host = hostOf(url);
  screen.url = url;
  screen.scroll = 0;
  screen.field = null;
  if (host.endsWith('linkedin.com')) {
    screen.page = screen.signedIn ? 'feed' : 'signin';
    screen.title = screen.signedIn ? 'Feed | LinkedIn' : 'Sign in | LinkedIn';
  } else if (host.includes('duckduckgo') || host.includes('google')) {
    screen.page = 'search';
    screen.title = 'Search results';
  } else if (url === 'about:blank') {
    screen.page = 'blank';
    screen.title = 'New tab';
  } else if (url.includes('item?id=')) {
    screen.page = 'article';
    screen.title = 'Show HN: A team of bots in a chat app';
  } else {
    screen.page = 'feed';
    screen.title = host || url;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Applies one input event from the person driving the desktop. */
export function applyInput(screen: FakeScreen, input: ComputerInput): void {
  switch (input.type) {
    case 'move':
      screen.cursor = { x: input.x, y: input.y };
      return;
    case 'click': {
      screen.cursor = { x: input.x, y: input.y };
      screen.click = { x: input.x, y: input.y, at: Date.now() };
      if (screen.page === 'signin') {
        if (inBox(input, SIGNIN.email)) screen.field = 'email';
        else if (inBox(input, SIGNIN.password)) screen.field = 'password';
        else if (inBox(input, SIGNIN.button)) submitSignIn(screen);
        else screen.field = null;
      }
      return;
    }
    case 'scroll':
      screen.scroll = Math.max(0, Math.min(600, screen.scroll + input.dy * 40));
      return;
    case 'type':
      if (screen.field === 'email') screen.email = (screen.email + input.text).slice(0, 40);
      if (screen.field === 'password') screen.password = (screen.password + input.text).slice(0, 40);
      return;
    case 'key':
      if (input.key === 'BackSpace') {
        if (screen.field === 'email') screen.email = screen.email.slice(0, -1);
        if (screen.field === 'password') screen.password = screen.password.slice(0, -1);
      } else if (input.key === 'Tab' && screen.page === 'signin') {
        screen.field = screen.field === 'email' ? 'password' : 'email';
      } else if (input.key === 'Return' && screen.page === 'signin') {
        submitSignIn(screen);
      }
      return;
  }
}

function submitSignIn(screen: FakeScreen): void {
  if (!screen.email || !screen.password) return;
  screen.signedIn = true;
  screen.password = '';
  navigate(screen, 'https://www.linkedin.com/feed/');
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIGNIN = {
  card: { x: 440, y: 170, w: 400, h: 430 },
  email: { x: 480, y: 300, w: 320, h: 48 },
  password: { x: 480, y: 380, w: 320, h: 48 },
  button: { x: 480, y: 470, w: 320, h: 48 },
} satisfies Record<string, Box>;

const inBox = (point: { x: number; y: number }, box: Box) =>
  point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TOP = 88;

function chrome(screen: FakeScreen): string {
  const title = escape(screen.title.length > 28 ? `${screen.title.slice(0, 27)}…` : screen.title);
  return `
  <rect width="1280" height="${TOP}" fill="#dfe1e5"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
  <path d="M86 40 q0 -26 14 -26 h220 q14 0 14 26 z" fill="#ffffff"/>
  <text x="108" y="32" font-size="13" fill="#202124">${title}</text>
  <rect y="40" width="1280" height="48" fill="#ffffff"/>
  <text x="20" y="70" font-size="18" fill="#5f6368">‹  ›  ↻</text>
  <rect x="110" y="48" width="1040" height="32" rx="16" fill="#f1f3f4"/>
  <text x="130" y="69" font-size="14" fill="#202124">${escape(screen.url)}</text>
  <rect y="${TOP - 1}" width="1280" height="1" fill="#dadce0"/>`;
}

function bars(x: number, y: number, widths: number[], color = '#e8eaed', height = 12, gap = 22): string {
  return widths.map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${height}" rx="6" fill="${color}"/>`).join('');
}

function page(screen: FakeScreen, frame: number): string {
  const y0 = TOP - screen.scroll;
  switch (screen.page) {
    case 'blank':
      return `<text x="640" y="430" text-anchor="middle" font-size="22" fill="#9aa0a6">Chromium</text>`;
    case 'signin': {
      const { card, email, password, button } = SIGNIN;
      const caret = Math.floor(frame / 2) % 2 === 0;
      const field = (box: Box, value: string, placeholder: string, focused: boolean) => `
        <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="#ffffff" stroke="${focused ? '#0a0a0a' : '#c4c7c5'}" stroke-width="${focused ? 2 : 1}"/>
        <text x="${box.x + 14}" y="${box.y + 30}" font-size="16" fill="${value ? '#202124' : '#80868b'}">${escape(value || placeholder)}${focused && caret ? '|' : ''}</text>`;
      return `
        <rect x="0" y="${TOP}" width="1280" height="${DESKTOP_HEIGHT - TOP}" fill="#f3f2ef"/>
        <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="14" fill="#ffffff" stroke="#e0dfdc"/>
        <text x="480" y="230" font-size="30" font-weight="600" fill="#191919">Sign in</text>
        <text x="480" y="262" font-size="14" fill="#666666">Stay updated on your professional world</text>
        ${field(email, screen.email, 'Email or phone', screen.field === 'email')}
        ${field(password, '•'.repeat(screen.password.length), 'Password', screen.field === 'password')}
        <rect x="${button.x}" y="${button.y}" width="${button.w}" height="${button.h}" rx="24" fill="#0a66c2"/>
        <text x="640" y="${button.y + 30}" text-anchor="middle" font-size="16" font-weight="600" fill="#ffffff">Sign in</text>
        <text x="640" y="560" text-anchor="middle" font-size="13" fill="#666666">The bot waits while you sign in. It never sees what you type here.</text>`;
    }
    case 'search':
      return `
        <rect x="0" y="${TOP}" width="1280" height="${DESKTOP_HEIGHT - TOP}" fill="#ffffff"/>
        <rect x="160" y="${y0 + 28}" width="620" height="44" rx="22" fill="#ffffff" stroke="#dadce0"/>
        ${[0, 1, 2, 3, 4]
          .map(
            (i) => `<text x="160" y="${y0 + 120 + i * 110}" font-size="13" fill="#5f6368">example-${i + 1}.com</text>
              <text x="160" y="${y0 + 144 + i * 110}" font-size="20" fill="#1a0dab">Result ${i + 1}: what the bot found</text>
              ${bars(160, y0 + 158 + i * 110, [560, 420], '#eceff1', 10, 18)}`,
          )
          .join('')}`;
    case 'article':
      return `
        <rect x="0" y="${TOP}" width="1280" height="${DESKTOP_HEIGHT - TOP}" fill="#f6f6ef"/>
        <rect x="120" y="${TOP + 10}" width="1040" height="30" fill="#ff6600"/>
        <text x="132" y="${TOP + 31}" font-size="15" font-weight="700" fill="#000000">Hacker News</text>
        <text x="132" y="${y0 + 90}" font-size="20" fill="#000000">Show HN: A team of bots in a chat app</text>
        <text x="132" y="${y0 + 116}" font-size="13" fill="#828282">412 points · 188 comments</text>
        ${bars(150, y0 + 150, [820, 760, 640, 0, 780, 700, 520, 0, 810, 590], '#e4e4dc', 11, 26)}`;
    case 'feed':
      return `
        <rect x="0" y="${TOP}" width="1280" height="${DESKTOP_HEIGHT - TOP}" fill="#f3f2ef"/>
        ${[0, 1, 2]
          .map(
            (i) => `<rect x="340" y="${y0 + 24 + i * 230}" width="600" height="210" rx="10" fill="#ffffff" stroke="#e0dfdc"/>
              <circle cx="380" cy="${y0 + 64 + i * 230}" r="20" fill="#d0d4d9"/>
              ${bars(412, y0 + 52 + i * 230, [180, 120], '#e3e6e8', 10, 18)}
              ${bars(364, y0 + 104 + i * 230, [540, 500, 380], '#eceff1', 12, 24)}`,
          )
          .join('')}
        ${screen.signedIn ? `<text x="960" y="${TOP + 40}" font-size="14" fill="#057642">Signed in</text>` : ''}`;
  }
}

function cursor(screen: FakeScreen): string {
  const { x, y } = screen.cursor;
  return `<path transform="translate(${x} ${y})" d="M0 0 L0 22 L6 16 L11 26 L15 24 L10 14 L18 14 Z" fill="#000000" stroke="#ffffff" stroke-width="1.5"/>`;
}

function ripple(screen: FakeScreen, now: number): string {
  if (!screen.click) return '';
  const age = now - screen.click.at;
  if (age > 700) return '';
  const r = 10 + age / 25;
  const opacity = (1 - age / 700).toFixed(2);
  return `<circle cx="${screen.click.x}" cy="${screen.click.y}" r="${r.toFixed(1)}" fill="none" stroke="#0a0a0a" stroke-width="3" opacity="${opacity}"/>`;
}

/** Draws the fake desktop as an SVG, the mock's stand-in for the server's JPEG frame. */
export function renderScreen(screen: FakeScreen, now = Date.now()): string {
  const frame = Math.floor(now / 250);
  const clock = new Date(now).toISOString().slice(11, 19);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DESKTOP_WIDTH}" height="${DESKTOP_HEIGHT}" viewBox="0 0 ${DESKTOP_WIDTH} ${DESKTOP_HEIGHT}" font-family="Inter, Arial, sans-serif">
  <rect width="${DESKTOP_WIDTH}" height="${DESKTOP_HEIGHT}" fill="#ffffff"/>
  <g>${page(screen, frame)}</g>
  ${chrome(screen)}
  <rect x="1150" y="772" width="122" height="22" rx="11" fill="#202124" opacity="0.72"/>
  <text x="1211" y="788" text-anchor="middle" font-size="12" fill="#ffffff" font-family="monospace">${clock}</text>
  ${ripple(screen, now)}
  ${cursor(screen)}
</svg>`;
}
