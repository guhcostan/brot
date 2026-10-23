import { useEffect, useState, type ReactElement } from 'react';
import type { Bot, Device, Routine } from '@brot/protocol';
import { Button } from '@brot/ui';
import type { Provider, Room } from '../data/client';
import { t, type TranslationKey } from '../i18n';
import { gettingStartedItems, type GettingStartedItem, type GettingStartedItemId } from '../onboarding';
import type { ThreadState } from '../state/thread';
import { useClient } from './client';
import { Dialog } from './Dialog';
import { GettingStartedChecklist } from './GettingStartedChecklist';
import { Sparkle } from './icons';

export interface GettingStartedPanelProps {
  open: boolean;
  bots: readonly Bot[];
  rooms: readonly Room[];
  threads: Readonly<Record<string, ThreadState>>;
  /** Closes for this session (Remind me later, or the dialog's close). */
  onClose: () => void;
  /** Persists the dismissal (Don't show again). */
  onDismiss: () => void;
  onAddKey: () => void;
  onSayHello: () => void;
  onGiveTools: () => void;
  onScheduleRoutine: () => void;
  onPairPhone: () => void;
}

const ACTION_KEY: Record<GettingStartedItemId, TranslationKey> = {
  modelKey: 'gettingStarted.addKey',
  hello: 'gettingStarted.sayHello',
  tools: 'gettingStarted.giveTools',
  routine: 'gettingStarted.scheduleRoutine',
  phone: 'gettingStarted.pairPhone',
};

/** The dismissible Getting started dialog: five calm steps, with the checks derived from loaded data. */
export function GettingStartedPanel({
  open,
  bots,
  rooms,
  threads,
  onClose,
  onDismiss,
  onAddKey,
  onSayHello,
  onGiveTools,
  onScheduleRoutine,
  onPairPhone,
}: GettingStartedPanelProps): ReactElement {
  const client = useClient();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setProviders(null);
    setRoutines(null);
    setDevices(null);
    setFailed(false);
    void Promise.allSettled([client.listProviders(), client.listRoutines(), client.listDevices()]).then(([providerResult, routineResult, deviceResult]) => {
      if (!active) return;
      if (providerResult.status === 'fulfilled') setProviders(providerResult.value);
      if (routineResult.status === 'fulfilled') setRoutines(routineResult.value);
      if (deviceResult.status === 'fulfilled') setDevices(deviceResult.value);
      if (providerResult.status === 'rejected' || routineResult.status === 'rejected' || deviceResult.status === 'rejected') setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [client, open, attempt]);

  const base = gettingStartedItems({ providers, routines, devices, bots, rooms, threads });
  const withStatus = (item: GettingStartedItem, loaded: boolean): GettingStartedItem => ({
    ...item,
    loading: !loaded && !failed,
    failed: !loaded && failed,
  });
  const items = base.map((item) => {
    if (item.id === 'modelKey') return withStatus(item, providers !== null);
    if (item.id === 'routine') return withStatus(item, routines !== null);
    if (item.id === 'phone') return withStatus(item, devices !== null);
    return item;
  });

  const act = (id: GettingStartedItemId) => {
    if (id === 'modelKey') onAddKey();
    else if (id === 'hello') onSayHello();
    else if (id === 'tools') onGiveTools();
    else if (id === 'routine') onScheduleRoutine();
    else onPairPhone();
  };

  const nextPending = items.find((item) => !item.done && !item.optional && !item.loading) ?? items.find((item) => !item.done && !item.loading);
  const primary = nextPending === undefined ? { label: 'gettingStarted.close' as TranslationKey, run: onClose } : { label: ACTION_KEY[nextPending.id], run: () => act(nextPending.id) };

  return (
    <Dialog
      open={open}
      size="md"
      title={t('gettingStarted.title')}
      description={t('gettingStarted.description')}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        <GettingStartedChecklist items={items} onAction={act} onRetry={() => setAttempt((current) => current + 1)} />
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button variant="ghost" size="sm" onClick={onDismiss} className="text-xs text-ink-2">
            {t('gettingStarted.dismiss')}
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('gettingStarted.later')}
          </Button>
          <Button variant="primary" size="sm" onClick={primary.run}>
            <Sparkle size={14} />
            {t(primary.label)}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
