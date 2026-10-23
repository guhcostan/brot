import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ApprovalDecision, Attachment, Bot, Thread } from '@brot/protocol';
import { BotAvatar, Button, EmptyState, Skeleton, StatusDot, TypingIndicator, type BotStatus } from '@brot/ui';
import type { Provider } from '../data/client';
import type { VoiceContext } from '../voice';
import { avatarOf } from '../format';
import { t } from '../i18n';
import type { ThreadState } from '../state/thread';
import { Composer } from './Composer';
import { botStatusLabel } from './taskLabels';
import { ChevronLeft, Pencil, Sparkle, SpeakerOff } from './icons';
import { ThreadModelPicker } from './ThreadModelPicker';
import { useAutoSpeak } from './useAutoSpeak';
import { useLiveMood } from './mood';
import { Timeline } from './Timeline';

export interface ThreadViewProps {
  bot: Bot;
  /** The thread's title, as the sidebar and the server's auto-title show it. */
  title: string;
  /** The thread entity, when the list has loaded; its model override feeds the header badge. */
  threadMeta?: Thread;
  /** Loads the configured providers for the model picker. */
  loadProviders?: () => Promise<Provider[]>;
  /** Patches this thread's model; null goes back to the bot's model. */
  onPickThreadModel?: (model: string | null) => Promise<unknown>;
  /** Voice availability and the speak call for listen/auto-speak. */
  voice?: VoiceContext;
  /** Runs a recognized composer slash command; resolves to an inline message or null. */
  onCommand?: (name: string, args: string) => Promise<string | null>;
  thread: ThreadState;
  /** False until the bot's history has loaded. */
  loaded: boolean;
  status: BotStatus;
  onSend: (content: string, attachmentIds: string[]) => Promise<void>;
  /** Uploads one file into this thread; enables the attach affordance. */
  uploadAttachment?: (file: File) => Promise<Attachment>;
  /** Deletes an upload that never made it into a message. */
  discardAttachment?: (attachment: Attachment) => Promise<void>;
  onEdit: () => void;
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
  onOpenBots: () => void;
  onOpenContext: () => void;
}

/** Keeps a log scrolled to the newest entry as it grows. */
export function useStickToBottom(deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = ref.current;
    if (!log) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, deps);
  return ref;
}

export function ThreadView({ bot, title, threadMeta, loadProviders, onPickThreadModel, voice, onCommand, thread, loaded, status, onSend, uploadAttachment, discardAttachment, onEdit, onDecide, onOpenBots, onOpenContext }: ThreadViewProps): ReactElement {
  const [modelOpen, setModelOpen] = useState(false);
  const autoSpeak = useAutoSpeak({ thread, voice, defaultBotId: bot.id, speaks: () => bot.speakReplies === true });
  const effectiveModel = threadMeta?.model ?? bot.model;
  const lastItem = thread.items.at(-1);
  const streaming = lastItem?.kind === 'message' && lastItem.streaming;
  const typing = thread.run === 'running' && !streaming;
  const logRef = useStickToBottom([thread.items.length, lastItem, typing]);

  const avatar = avatarOf(bot);
  const mood = useLiveMood(status);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots} onOpenContext={onOpenContext}>
        <BotAvatar shape={avatar.shape} color={avatar.color} mood={mood} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{title}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{t('thread.subtitle', { name: bot.name, job: bot.job })}</p>
        </div>
        {threadMeta !== undefined && loadProviders !== undefined && onPickThreadModel !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setModelOpen(true)}
            aria-label={t('thread.modelChange', { model: effectiveModel ?? t('thread.noModel') })}
            title={t('thread.modelChange', { model: effectiveModel ?? t('thread.noModel') })}
            className="inline-flex max-w-[45%] gap-1.5 !px-2 font-mono text-xs sm:max-w-[240px]"
          >
            <Sparkle size={13} />
            <span className="truncate">{effectiveModel ?? t('thread.noModel')}</span>
            {threadMeta.model === undefined ? <span className="font-sans text-ink-3">· {t('thread.modelDefault')}</span> : null}
          </Button>
        ) : null}
        {autoSpeak.playing ? (
          <Button variant="ghost" size="sm" onClick={autoSpeak.stop} aria-label={t('voice.stopAutoSpeak')} title={t('voice.stopAutoSpeak')}>
            <SpeakerOff size={16} />
          </Button>
        ) : null}
        <StatusDot key={status} status={status} label={botStatusLabel(status)} className="hidden animate-[brot-fade_var(--dur-base)_linear_both] sm:inline-flex" />
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={t('thread.edit', { name: bot.name })} title={t('thread.edit', { name: bot.name })}>
          <Pencil size={16} />
        </Button>
      </PaneHeader>
      {threadMeta !== undefined && loadProviders !== undefined && onPickThreadModel !== undefined ? (
        <ThreadModelPicker open={modelOpen} bot={bot} thread={threadMeta} onClose={() => setModelOpen(false)} loadProviders={loadProviders} onPick={onPickThreadModel} />
      ) : null}
      {bot.archived ? (
        <div className="flex flex-none items-center justify-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink-2">
          {t('thread.archived', { name: bot.name })}
          <button type="button" onClick={onEdit} className="font-medium text-ink underline underline-offset-2">
            {t('thread.manage')}
          </button>
        </div>
      ) : null}

      <div ref={logRef} role="log" aria-live="polite" aria-label={t('thread.log', { name: bot.name })} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-6 px-4 py-8 md:px-6">
          {!loaded ? (
            <ThreadSkeleton />
          ) : thread.items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<BotAvatar shape={avatar.shape} color={avatar.color} mood={mood} size="lg" />}
                title={t('thread.emptyTitle', { name: bot.name })}
                description={t('thread.emptyBody', { job: bot.job, name: bot.name })}
              />
            </div>
          ) : (
            <Timeline thread={thread} mode="dm" defaultBotId={bot.id} members={[bot]} onDecide={onDecide} />
          )}
          {typing ? <TypingIndicator label={`${bot.name}: ${t('status.working')}`} className="-mt-2" /> : null}
        </div>
      </div>

      <Composer
        targetName={bot.name}
        uploadAttachment={uploadAttachment}
        discardAttachment={discardAttachment}
        onSend={(content, _mentions, attachmentIds) => onSend(content, attachmentIds)}
        {...(onCommand === undefined ? {} : { onCommand })}
      />
    </section>
  );
}

export function ThreadSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label={t('app.loading')}>
      <div className="flex justify-end">
        <Skeleton shape="block" width="46%" height={40} />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton width={90} height={10} />
        <Skeleton width="92%" />
        <Skeleton width="80%" />
        <Skeleton width="54%" />
      </div>
      <Skeleton shape="block" height={40} />
      <div className="flex flex-col gap-2">
        <Skeleton width="86%" />
        <Skeleton width="40%" />
      </div>
    </div>
  );
}

export function PaneHeader({
  children,
  onOpenBots,
  onOpenContext,
}: {
  children: ReactNode;
  onOpenBots: () => void;
  onOpenContext?: () => void;
}): ReactElement {
  return (
    <header data-avatar-zone className="titlebar flex h-14 flex-none items-center gap-3 border-b border-line bg-bg px-3 md:px-5">
      <Button variant="ghost" size="sm" className="md:hidden" onClick={onOpenBots} aria-label={t('thread.bots')}>
        <ChevronLeft />
      </Button>
      {children}
      {onOpenContext ? (
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onOpenContext}>
          {t('thread.context')}
        </Button>
      ) : null}
    </header>
  );
}
