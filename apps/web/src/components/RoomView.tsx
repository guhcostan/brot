import type { ReactElement } from 'react';
import type { ApprovalDecision, Attachment, Bot } from '@brot/protocol';
import { AvatarStack, EmptyState, StatusDot, type BotStatus } from '@brot/ui';
import type { Room, RoomMessage } from '../data/client';
import { avatarOf } from '../format';
import { t } from '../i18n';
import { botActivity, type ThreadState } from '../state/thread';
import { Composer } from './Composer';
import { botStatusLabel } from './taskLabels';
import { moodOf } from './team';
import { Timeline, WorkingBots } from './Timeline';
import { PaneHeader, useStickToBottom } from './ThreadView';

export interface RoomViewProps {
  room: Room;
  members: Bot[];
  thread: ThreadState;
  status: BotStatus;
  onSend: (input: RoomMessage) => Promise<void>;
  /** Uploads one file into this room; enables the attach affordance. */
  uploadAttachment?: (file: File) => Promise<Attachment>;
  /** Deletes an upload that never made it into a message. */
  discardAttachment?: (attachment: Attachment) => Promise<void>;
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
  onOpenBots: () => void;
  onOpenContext: () => void;
}

/** Names a list for screen readers: "Capy, Onça and 2 more". */
export function memberSummary(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return t('room.andMore', { names: names.slice(0, max).join(', '), count: String(names.length - max) });
}

export function RoomView({ room, members, thread, status, onSend, uploadAttachment, discardAttachment, onDecide, onOpenBots, onOpenContext }: RoomViewProps): ReactElement {
  const lastItem = thread.items.at(-1);
  const logRef = useStickToBottom([thread.items.length, lastItem, Object.keys(thread.activeRuns).length]);
  const lead = members.find((bot) => bot.id === room.thread.leadBotId);
  const next = members.find((bot) => bot.id === thread.baton) ?? lead;
  const names = members.map((bot) => bot.name);
  const stack = members.map((bot) => ({ id: bot.id, ...avatarOf(bot), mood: moodOf(botActivity(thread, bot.id)) }));
  const note =
    room.thread.responder === 'mention'
      ? t('room.ruleMention')
      : t('room.ruleLead', { name: next?.name ?? t('team.unknownBot') });

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots} onOpenContext={onOpenContext}>
        <AvatarStack members={stack} max={4} size={24} label={memberSummary(names)} className="[--stack-cutout:var(--bg)]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{room.thread.title}</h1>
          <p className="m-0 truncate text-sm text-ink-2">
            {t('room.subtitle', { count: String(members.length), lead: lead?.name ?? t('team.unknownBot') })}
          </p>
        </div>
        {status === 'idle' ? null : <StatusDot status={status} label={botStatusLabel(status)} className="hidden sm:inline-flex" />}
      </PaneHeader>

      <div ref={logRef} role="log" aria-live="polite" aria-label={t('room.log', { title: room.thread.title })} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-6 px-4 py-8 md:px-6">
          {thread.items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<AvatarStack members={stack} max={6} size="lg" />}
                title={t('room.emptyTitle', { title: room.thread.title })}
                description={t('room.emptyBody', { names: memberSummary(names, 4) })}
              />
            </div>
          ) : (
            <Timeline thread={thread} mode="room" members={members} onDecide={onDecide} />
          )}
          <WorkingBots thread={thread} />
        </div>
      </div>

      <Composer
        targetName={room.thread.title}
        placeholder={t('room.placeholder')}
        note={note}
        members={members}
        uploadAttachment={uploadAttachment}
        discardAttachment={discardAttachment}
        onSend={(content, mentions, attachmentIds) =>
          onSend({ content, mentions, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) })
        }
      />
    </section>
  );
}
