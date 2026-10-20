import { useRef, type ReactElement, type ReactNode } from 'react';
import { AvatarStack, BotAvatar, StatusDot, usePrefersReducedMotion, type AvatarMood, type BotStatus } from '@brot/ui';
import { CAST, type CastId, type DemoCopy } from '../i18n/ui';
import { splitMentions } from '../lib/mentions';
import { useInView, useTimeline } from '../lib/useLiveLoop';

/*
 * The hero mockup: a scripted room where Capy delegates, Onça fixes a bug on its own computer,
 * and Tuca asks before sending. Steps hold for these many ms, then the loop restarts.
 */
const DURATIONS = [700, 1100, 1400, 1000, 1600, 1600, 2400, 1400, 1500, 3400, 800, 4200, 700] as const;
const STILL_STEP = 9;

const S = {
  user: 1,
  capyTyping: 2,
  capy: 3,
  oncaStart: 4,
  oncaRead: 5,
  oncaTests: 6,
  onca: 7,
  tucaTyping: 8,
  tuca: 9,
  press: 10,
  sent: 11,
  fade: 12,
} as const;

const SIDEBAR: readonly CastId[] = ['capy', 'onca', 'tuca', 'tamu', 'lobo', 'jabu'];
const ROOM: readonly CastId[] = ['capy', 'onca', 'tuca', 'lobo'];

const MOOD: Record<BotStatus, AvatarMood> = {
  idle: 'idle',
  working: 'thinking',
  waiting: 'approval',
  error: 'error',
  ok: 'success',
  sleeping: 'sleeping',
};

function statusAt(id: CastId, step: number): BotStatus {
  switch (id) {
    case 'capy':
      return step === S.capyTyping ? 'working' : 'idle';
    case 'onca':
      if (step >= S.oncaStart && step < S.onca) return 'working';
      return step >= S.onca && step < S.fade ? 'ok' : 'idle';
    case 'tuca':
      if (step === S.tucaTyping) return 'working';
      if (step === S.tuca || step === S.press) return 'waiting';
      return step === S.sent ? 'ok' : 'idle';
    case 'jabu':
      return 'sleeping';
    default:
      return 'idle';
  }
}

function Rich({ text }: { text: string }): ReactElement {
  return (
    <>
      {splitMentions(text).map((part, index) =>
        part.mention ? (
          <span key={index} className="demo-mention">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function BotMessage({ id, time, children, mood }: { id: CastId; time: string; children: ReactNode; mood: AvatarMood }): ReactElement {
  const bot = CAST[id];
  return (
    <div className="demo-msg">
      <BotAvatar species={bot.species} color={bot.color} mood={mood} size={28} />
      <div className="demo-msg__body">
        <p className="demo-msg__head">
          <span className="demo-msg__name">{bot.name}</span>
          <span className="demo-msg__time">{time}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

function Typing({ id, label }: { id: CastId; label: string }): ReactElement {
  const bot = CAST[id];
  return (
    <div className="demo-msg demo-msg--typing">
      <BotAvatar species={bot.species} color={bot.color} mood="thinking" size={28} />
      <div className="demo-msg__body">
        <p className="demo-msg__head">
          <span className="demo-msg__name">{bot.name}</span>
          <span className="demo-msg__time">{label}</span>
        </p>
        <span className="brot-typing" aria-hidden="true">
          <span className="brot-typing__dot" />
          <span className="brot-typing__dot" />
          <span className="brot-typing__dot" />
        </span>
      </div>
    </div>
  );
}

function Cursor(): ReactElement {
  return (
    <svg className="screen-cursor" viewBox="0 0 16 20" width="14" height="18" aria-hidden="true">
      <path d="M1 1l13 10.5-6 .6 3.6 6.4-2.6 1.4-3.6-6.5L1 17.6z" />
    </svg>
  );
}

/** A grayscale fake desktop: a browser, then a terminal, then the PR page. */
function Screen({ step, copy }: { step: number; copy: DemoCopy }): ReactElement {
  const phase = step < S.oncaStart || step >= S.fade ? 'idle' : step === S.oncaStart ? 'issue' : step === S.oncaRead ? 'read' : step === S.oncaTests ? 'tests' : 'pr';
  const url =
    phase === 'idle' ? 'about:blank' : phase === 'pr' ? 'git.acme.example/app/pulls/new' : 'git.acme.example/app/issues/412';
  return (
    <div className="screen" data-phase={phase}>
      <div className="screen__browser">
        <div className="screen__tabs">
          <span className="screen__tab">{phase === 'pr' ? 'New pull request' : phase === 'idle' ? 'New tab' : 'Issue #412'}</span>
        </div>
        <div className="screen__url">
          <span key={url} className="screen__url-text">
            {url}
          </span>
        </div>
        <div className="screen__page">
          {phase === 'pr' ? (
            <div key="pr" className="screen__doc">
              <p className="screen__h">fix(export): keep timezone in CSV dates</p>
              <span className="screen__line" style={{ width: '88%' }} />
              <span className="screen__line" style={{ width: '72%' }} />
              <span className="screen__line" style={{ width: '80%' }} />
              <span className="screen__btn">Create draft</span>
            </div>
          ) : phase === 'idle' ? null : (
            <div key="issue" className="screen__doc">
              <p className="screen__h">CSV export shifts dates by one day</p>
              <span className="screen__line" style={{ width: '92%' }} />
              <span className="screen__line" style={{ width: '64%' }} />
              <span className="screen__line" style={{ width: '84%' }} />
              <span className="screen__line" style={{ width: '58%' }} />
              <span className="screen__line" style={{ width: '76%' }} />
              <span className="screen__scan" />
            </div>
          )}
        </div>
      </div>
      {phase === 'tests' || phase === 'pr' ? (
        <div className="screen__term" data-done={phase === 'pr' ? 'true' : undefined}>
          {copy.terminal.map((line, index) => (
            <span key={line} className="screen__term-line" style={{ animationDelay: `${index * 520}ms` }}>
              {line}
            </span>
          ))}
        </div>
      ) : null}
      <span className="cursor-layer">
        <Cursor />
      </span>
    </div>
  );
}

export interface AppDemoProps {
  copy: DemoCopy;
}

export default function AppDemo({ copy }: AppDemoProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const inView = useInView(rootRef);
  const step = useTimeline(DURATIONS, inView, reduced ? STILL_STEP : null);
  const onca = statusAt('onca', step);
  const tuca = statusAt('tuca', step);
  const stepLabel =
    step >= S.oncaStart && step <= S.onca
      ? copy.computer.steps[Math.min(step - S.oncaStart, 3)]
      : step > S.onca && step < S.fade
        ? copy.status.done
        : copy.status.idle;

  return (
    <div ref={rootRef} className="demo" data-fading={step === S.fade ? 'true' : undefined} data-avatar-zone>
      <aside className="demo__side">
        <div className="demo__workspace">
          <span className="demo__ws-mark" aria-hidden="true">
            A
          </span>
          {copy.workspace}
        </div>
        <div className="demo__search">{copy.search}</div>
        <p className="demo__label">{copy.roomsLabel}</p>
        <ul className="demo__rooms">
          <li className="is-selected">
            <span aria-hidden="true">#</span> {copy.room}
          </li>
          {copy.otherRooms.map((room) => (
            <li key={room}>
              <span aria-hidden="true">#</span> {room}
            </li>
          ))}
        </ul>
        <p className="demo__label">{copy.botsLabel}</p>
        <ul className="demo__bots">
          {SIDEBAR.map((id) => {
            const bot = CAST[id];
            const status = statusAt(id, step);
            const label =
              status === 'working' ? copy.status.working : status === 'waiting' ? copy.status.waiting : status === 'ok' ? copy.status.done : status === 'sleeping' ? copy.status.sleeping : copy.roles[id];
            return (
              <li key={id} className="demo__bot">
                <BotAvatar species={bot.species} color={bot.color} mood={MOOD[status]} size={26} />
                <span className="demo__bot-text">
                  <span className="demo__bot-name">{bot.name}</span>
                  {status === 'idle' ? <span className="demo__bot-role">{label}</span> : <StatusDot status={status} label={label} />}
                </span>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="demo__thread">
        <header className="demo__head">
          <span className="demo__room">
            <span aria-hidden="true">#</span> {copy.room}
          </span>
          <span className="demo__head-meta">
            <AvatarStack members={ROOM.map((id) => ({ id, ...CAST[id] }))} max={4} size={20} showCount={false} />
            <span>{copy.roomMeta}</span>
          </span>
        </header>
        <div className="demo__messages">
          {step >= S.user ? (
            <div className="demo-msg demo-msg--user">
              <p className="demo-bubble">
                <Rich text={copy.messages.user} />
              </p>
            </div>
          ) : null}
          {step === S.capyTyping ? <Typing id="capy" label={copy.typing} /> : null}
          {step >= S.capy ? (
            <BotMessage id="capy" time="09:12" mood="idle">
              <p className="demo-msg__text">
                <Rich text={copy.messages.capy} />
              </p>
            </BotMessage>
          ) : null}
          {step >= S.capy ? (
            <p className="demo-note">
              <span aria-hidden="true">→</span> {copy.handoff}
            </p>
          ) : null}
          {step >= S.oncaStart && step < S.onca ? <Typing id="onca" label={copy.typing} /> : null}
          {step >= S.onca ? (
            <BotMessage id="onca" time="09:19" mood={MOOD[onca]}>
              <p className="demo-msg__text">
                <Rich text={copy.messages.onca} />
              </p>
              <p className="demo-tool">
                <span className="demo-tool__name">{copy.tool.name}</span>
                <span className="demo-tool__summary">{copy.tool.summary}</span>
                <span className="demo-tool__ok" aria-hidden="true">
                  ✓
                </span>
              </p>
            </BotMessage>
          ) : null}
          {step === S.tucaTyping ? <Typing id="tuca" label={copy.typing} /> : null}
          {step >= S.tuca ? (
            <BotMessage id="tuca" time="09:21" mood={MOOD[tuca]}>
              <p className="demo-msg__text">
                <Rich text={copy.messages.tuca} />
              </p>
              <div className="brot-approval demo-approval" data-status={step >= S.sent ? 'allowed' : 'pending'}>
                <div className="brot-approval__header">
                  {step >= S.sent ? (
                    <StatusDot status="ok" label={copy.approval.allowed} />
                  ) : (
                    <StatusDot status="waiting" label={copy.status.waiting} />
                  )}
                  <span className="brot-badge">{copy.approval.kind}</span>
                </div>
                <p className="brot-approval__title">{copy.approval.title}</p>
                <p className="brot-approval__meta">{copy.approval.meta}</p>
                {step >= S.sent ? null : (
                  <div className="brot-approval__actions">
                    <span className="brot-button" data-variant="primary" data-size="sm" data-pressed={step === S.press ? 'true' : undefined}>
                      {copy.approval.allowOnce}
                    </span>
                    <span className="brot-button" data-variant="secondary" data-size="sm">
                      {copy.approval.allowAlways}
                    </span>
                    <span className="brot-button" data-variant="danger" data-size="sm">
                      {copy.approval.deny}
                    </span>
                  </div>
                )}
              </div>
            </BotMessage>
          ) : null}
          {step >= S.sent ? (
            <BotMessage id="tuca" time="09:22" mood={MOOD[tuca]}>
              <p className="demo-msg__text">{copy.messages.sent}</p>
            </BotMessage>
          ) : null}
        </div>
        <div className="demo__composer">
          <span>{copy.composer}</span>
          <span className="demo__send" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </span>
        </div>
      </section>

      <aside className="demo__context">
        <div className="demo__tabs">
          {copy.tabs.map((tab, index) => (
            <span key={tab} className={index === 0 ? 'is-active' : undefined}>
              {tab}
            </span>
          ))}
        </div>
        <div className="demo__computer-head">
          <BotAvatar species={CAST.onca.species} color={CAST.onca.color} mood={MOOD[onca]} size={22} />
          <span className="demo__computer-title">{copy.computer.title}</span>
          <span className="demo__live">
            <span className="demo__live-dot" aria-hidden="true" />
            {copy.computer.live}
          </span>
        </div>
        <Screen step={step} copy={copy} />
        <div className="demo__computer-foot">
          <span key={stepLabel} className="demo__step">
            {stepLabel}
          </span>
          <span className="brot-button" data-variant="secondary" data-size="sm">
            {copy.computer.takeOver}
          </span>
        </div>
        <ol className="demo__log">
          {copy.computer.steps.map((label, index) => {
            const at = step >= S.fade ? -1 : step - S.oncaStart;
            const state = at < 0 ? 'pending' : index < at || step >= S.onca ? 'done' : index === at ? 'active' : 'pending';
            return (
              <li key={label} data-state={state}>
                <span className="demo__log-mark" aria-hidden="true">
                  {state === 'done' ? '✓' : ''}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
