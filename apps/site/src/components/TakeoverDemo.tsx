import { useRef, type ReactElement } from 'react';
import { BotAvatar, usePrefersReducedMotion, type AvatarMood } from '@brot/ui';
import { CAST, type TakeoverCopy } from '../i18n/ui';
import { useInView, useTimeline } from '../lib/useLiveLoop';

/*
 * The computer-use demo: the bot reaches a sign-in, asks for a takeover, the person signs in and
 * gives control back, and the bot reads the page again. Step holds in ms; then it loops.
 */
const DURATIONS = [1800, 2600, 700, 1900, 1500, 900, 1000, 3800, 700] as const;
const STILL_STEP = 3;

const T = {
  browse: 0,
  ask: 1,
  press: 2,
  email: 3,
  password: 4,
  submit: 5,
  signedIn: 6,
  back: 7,
  fade: 8,
} as const;

const EMAIL = 'you@acme.example';

export interface TakeoverDemoProps {
  copy: TakeoverCopy;
}

export default function TakeoverDemo({ copy }: TakeoverDemoProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const inView = useInView(rootRef);
  const step = useTimeline(DURATIONS, inView, reduced ? STILL_STEP : null);

  const human = step >= T.press && step <= T.signedIn;
  const signedIn = step >= T.signedIn && step < T.fade;
  const mood: AvatarMood = step === T.back ? 'success' : step === T.ask || step === T.press ? 'approval' : human ? 'idle' : 'thinking';
  const cursor = step <= T.ask ? 'scan' : step === T.press ? 'button' : step === T.email ? 'email' : step === T.password ? 'password' : step === T.submit ? 'submit' : step === T.signedIn ? 'giveback' : 'rest';
  const tuca = CAST.tuca;

  const tree = signedIn
    ? ['- heading "Pipeline"', '- link "Ana · Acme" [ref=4]', '- link "Rafael · Norte" [ref=5]', '- button "New deal" [ref=6]']
    : [`- heading "${copy.pageTitle}"`, `- textbox "${copy.email}" [ref=1]`, `- textbox "${copy.password}" [ref=2]`, `- button "${copy.signIn}" [ref=3]`];

  return (
    <div ref={rootRef} className="takeover" data-human={human ? 'true' : undefined} data-fading={step === T.fade ? 'true' : undefined}>
      <div className="takeover__screen-wrap">
        <div className="takeover__bar">
          <BotAvatar species={tuca.species} color={tuca.color} mood={mood} size={24} />
          <span className="takeover__who">{human ? copy.youHave : copy.bot}</span>
          <span className="takeover__action">
            {human ? (
              <span className="brot-button" data-variant="primary" data-size="sm" data-pressed={step === T.signedIn ? 'true' : undefined}>
                {copy.giveBack}
              </span>
            ) : (
              <span className="brot-button" data-variant="secondary" data-size="sm">
                {copy.takeControl}
              </span>
            )}
          </span>
        </div>
        <div className="takeover__screen">
          <div className="screen__url">
            <span className="screen__url-text">{signedIn ? 'crm.acme.example/pipeline' : copy.url}</span>
          </div>
          <div className="takeover__page">
            {signedIn ? (
              <div key="dash" className="takeover__dash">
                <p className="screen__h">Pipeline</p>
                {['Ana · Acme', 'Rafael · Norte', 'Lucía · Sur'].map((row, index) => (
                  <span key={row} className="takeover__row" style={{ animationDelay: `${index * 90}ms` }}>
                    <span>{row}</span>
                    <span className="screen__line" style={{ width: `${40 - index * 8}%` }} />
                  </span>
                ))}
              </div>
            ) : (
              <form key="login" className="takeover__form" aria-hidden="true" onSubmit={(event) => event.preventDefault()}>
                <p className="screen__h">{copy.pageTitle}</p>
                <span className="takeover__label">{copy.email}</span>
                <span className="takeover__field" data-focus={step === T.email ? 'true' : undefined}>
                  {step >= T.email ? <span className="takeover__typed takeover__typed--email">{EMAIL}</span> : null}
                </span>
                <span className="takeover__label">{copy.password}</span>
                <span className="takeover__field" data-focus={step === T.password ? 'true' : undefined}>
                  {step >= T.password ? <span className="takeover__typed takeover__typed--pw">••••••••••</span> : null}
                </span>
                <span className="takeover__submit" data-pressed={step === T.submit ? 'true' : undefined}>
                  {copy.signIn}
                </span>
              </form>
            )}
          </div>
          <span className="cursor-layer" data-at={cursor}>
            <svg className="takeover__cursor" viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">
              <path d="M1 1l13 10.5-6 .6 3.6 6.4-2.6 1.4-3.6-6.5L1 17.6z" />
            </svg>
          </span>
          {step === T.ask || step === T.press ? (
            <div className="takeover__request" role="presentation">
              <BotAvatar species={tuca.species} color={tuca.color} mood="approval" size={28} />
              <p>
                <strong>{copy.bot}</strong> {copy.request}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="takeover__snapshot">
        <p className="takeover__snap-title">
          <span>{copy.snapshotTitle}</span>
          <span className="takeover__snap-tool">browser_snapshot</span>
        </p>
        <pre key={signedIn ? 'after' : 'before'} className="takeover__tree">
          {human ? `# ${copy.botWaits}\n# request_takeover …` : tree.join('\n')}
        </pre>
        <p key={step === T.back ? 'back' : 'idle'} className="takeover__status">
          {step === T.back ? copy.back : human ? copy.botWaits : `browser_open ${copy.url}`}
        </p>
      </div>
    </div>
  );
}
