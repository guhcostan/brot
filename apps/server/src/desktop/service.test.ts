import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Thread } from '@brot/protocol';
import { createTestContext, recordEvents, type TestContext } from '../testing';
import { createDesktopService, DesktopError, type DesktopService } from './service';
import { FAKE_JPEG, fakeProvider, fakeRunner, type FakeRunner } from './test-helpers';

let ctx: TestContext;
let runner: FakeRunner;
let desktop: DesktopService;
let bot: Bot;
let thread: Thread;

async function desktopBot(desktopOn: boolean): Promise<Bot> {
  return ctx.services.repos.bots.create({
    name: 'Ada',
    job: 'Researcher',
    engine: 'mock',
    instructions: '',
    computer: 'sandbox',
    desktop: desktopOn,
    egress: { mode: 'allowlist', allow: ['example.com'] },
  });
}

beforeEach(async () => {
  ctx = await createTestContext();
  runner = fakeRunner();
  const { repos, bus } = ctx.services;
  desktop = createDesktopService({
    provider: fakeProvider(),
    repos,
    bus,
    runner,
    takeoverWaitMs: 40,
    takeoverPollMs: 5,
  });
  bot = await desktopBot(true);
  thread = await repos.threads.create(bot.id, { title: 'Chat' });
});

afterEach(async () => {
  await ctx.close();
});

describe('desktop state', () => {
  it('reports none for a bot that never had a computer, and the desktop flag', async () => {
    expect(await desktop.state(bot)).toEqual({ state: 'none', desktop: true, width: 1280, height: 800, takeover: null });
  });

  it('starts the computer and desktop, records ready and publishes computer.status on the latest thread', async () => {
    const events = recordEvents(ctx.services.bus, thread.id);
    const view = await desktop.start(bot);
    expect(view.state).toBe('ready');
    expect(runner.calls.map((call) => call.argv[0])).toEqual(['brot-desktop-start']);
    const statuses = events.list.filter((event) => event.type === 'computer.status');
    expect(statuses.map((event) => (event.type === 'computer.status' ? event.state : ''))).toEqual(['starting', 'ready']);
    events.stop();
  });

  it('does not start a desktop for a bot without one', async () => {
    const plain = await desktopBot(false);
    await desktop.start(plain);
    expect(runner.calls.some((call) => call.argv[0] === 'brot-desktop-start')).toBe(false);
  });
});

describe('screen', () => {
  it('returns the JPEG frame and runs the capture with DISPLAY=:1', async () => {
    await desktop.start(bot);
    const frame = await desktop.screen(bot);
    expect(Array.from(frame)).toEqual(Array.from(FAKE_JPEG));
    const capture = runner.calls.findLast((call) => call.argv[0] === 'import');
    expect(capture?.argv).toEqual(['import', '-window', 'root', '-quality', '70', 'jpeg:-']);
    expect(capture?.env).toEqual({ DISPLAY: ':1' });
  });

  it('answers 404 for a bot without a desktop', async () => {
    const plain = await desktopBot(false);
    await expect(desktop.screen(plain)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 409 when the computer is not running', async () => {
    await expect(desktop.screen(bot)).rejects.toMatchObject({ status: 409 });
  });

  it('shares one in-flight capture between concurrent callers', async () => {
    await desktop.start(bot);
    const before = runner.calls.length;
    const [a, b] = await Promise.all([desktop.screen(bot), desktop.screen(bot)]);
    expect(a).toEqual(b);
    expect(runner.calls.length - before).toBe(1);
  });
});

describe('input', () => {
  it('refuses input unless a takeover is active', async () => {
    await expect(desktop.input(bot, { type: 'type', text: 'hi' })).rejects.toMatchObject({ status: 409 });
    expect(runner.calls).toHaveLength(0);
  });

  it('runs the xdotool argv for each event while the person has control', async () => {
    await desktop.start(bot);
    await desktop.setTakeover(bot, { active: true }, 'user');
    await desktop.input(bot, { type: 'click', x: 100, y: 200, button: 'left', double: false });
    const last = runner.calls.at(-1);
    expect(last?.argv[0]).toBe('xdotool');
    expect(last?.argv).toContain('mousemove');
    expect(last?.env).toEqual({ DISPLAY: ':1' });
  });
});

describe('takeover', () => {
  it('records the takeover and emits computer.takeover on the most recent thread', async () => {
    const events = recordEvents(ctx.services.bus, thread.id);
    const takeover = await desktop.setTakeover(bot, { active: true, reason: 'Solve the CAPTCHA' }, 'bot');
    expect(takeover).toMatchObject({ botId: bot.id, active: true, requestedBy: 'bot', reason: 'Solve the CAPTCHA' });
    const emitted = events.list.find((event) => event.type === 'computer.takeover');
    expect(emitted?.threadId).toBe(thread.id);
    events.stop();
  });

  it('reports the takeover in the state view', async () => {
    await desktop.setTakeover(bot, { active: true }, 'user');
    expect((await desktop.state(bot)).takeover).toMatchObject({ active: true, requestedBy: 'user' });
  });

  it('waits until control is handed back', async () => {
    await desktop.setTakeover(bot, { active: true }, 'bot');
    setTimeout(() => void desktop.setTakeover(bot, { active: false }, 'user'), 15);
    await expect(desktop.waitForControlBack(bot.id)).resolves.toBe(true);
  });

  it('gives up after the wait limit while the takeover is still active', async () => {
    await desktop.setTakeover(bot, { active: true }, 'bot');
    await expect(desktop.waitForControlBack(bot.id)).resolves.toBe(false);
  });
});

describe('browser commands', () => {
  it('runs brot-browser with the command and a JSON argument, and returns its result', async () => {
    runner.browserReply = { url: 'https://example.com/', title: 'Example' };
    const page = await desktop.browser(bot, 'open', { url: 'https://example.com/' });
    expect(page).toEqual({ url: 'https://example.com/', title: 'Example' });
    expect(runner.calls.at(-1)?.argv).toEqual(['brot-browser', 'open', JSON.stringify({ url: 'https://example.com/' })]);
  });

  it('turns a browser error line into a 409 with its message', async () => {
    runner.browserReply = (command) => ({ error: `${command} failed here` });
    runner.failWith = undefined;
    const failing = fakeRunner();
    failing.run = async (_bot, argv) =>
      argv[0] === 'brot-browser'
        ? { code: 1, stdout: new TextEncoder().encode('{"error":"that ref is not on the page; take a new snapshot"}'), stderr: '' }
        : { code: 0, stdout: new Uint8Array(), stderr: '' };
    const service = createDesktopService({ provider: fakeProvider(), repos: ctx.services.repos, bus: ctx.services.bus, runner: failing });
    const error = await service.browser(bot, 'click', { ref: '9' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DesktopError);
    expect((error as DesktopError).message).toBe('that ref is not on the page; take a new snapshot');
  });
});
