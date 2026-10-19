import { useMemo, useState, type ReactElement } from 'react';
import { BrandMark, EmptyState, cx, type BotStatus } from '@brot/ui';
import { ContextPanel } from './components/ContextPanel';
import { Sidebar } from './components/Sidebar';
import { ThreadView } from './components/ThreadView';
import { createClient } from './data';
import { t } from './i18n';
import { botStatus, emptyThread } from './state/thread';
import { useChat } from './state/useChat';

type Pane = 'bots' | 'thread' | 'context';

/**
 * Three panes like DESIGN.md section 7. Below md the app shows one pane at a time; below xl the
 * context panel is an overlay.
 */
export function App(): ReactElement {
  const client = useMemo(() => createClient(), []);
  const { state, select, send, decide } = useChat(client);
  const [pane, setPane] = useState<Pane>('thread');

  const selected = state.bots.find((bot) => bot.id === state.selectedBotId) ?? null;
  const threadOf = (botId: string) => state.threads[botId] ?? emptyThread;
  const statusOf = (botId: string): BotStatus => botStatus(threadOf(botId));

  return (
    <div className="grid h-dvh grid-cols-1 overflow-hidden bg-bg text-ink md:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)_320px]">
      <Sidebar
        bots={state.bots}
        statusOf={statusOf}
        selectedId={state.selectedBotId}
        onSelect={(botId) => {
          select(botId);
          setPane('thread');
        }}
        className={pane === 'bots' ? 'flex' : 'hidden md:flex'}
      />

      <main className={cx('min-h-0 min-w-0', pane === 'thread' ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <ThreadView
            key={selected.id}
            bot={selected}
            thread={threadOf(selected.id)}
            status={statusOf(selected.id)}
            onSend={(content) => send(selected.id, content)}
            onDecide={decide}
            onOpenBots={() => setPane('bots')}
            onOpenContext={() => setPane('context')}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<BrandMark size="lg" />} title={state.error ?? t('app.tagline')} />
          </div>
        )}
      </main>

      {selected ? (
        <ContextPanel
          bot={selected}
          thread={threadOf(selected.id)}
          onClose={() => setPane('thread')}
          className={pane === 'context' ? 'fixed inset-0 z-20 flex xl:static xl:z-auto' : 'hidden xl:flex'}
        />
      ) : null}
    </div>
  );
}
