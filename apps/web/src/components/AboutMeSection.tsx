import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CreateMemory, Memory, UpdateMemory } from '../data/client';
import { Badge, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import { t } from '../i18n';
import { useClient } from './client';
import { ConfirmDialog, Dialog } from './Dialog';
import { MemoryForm } from './MemoryForm';
import { MEMORY_KIND_KEY, memorySavedOnFormat } from './memoryShared';
import { Plus, Trash } from './icons';

export interface AboutMeSectionProps {
  /** Workspace facts to render before the client load resolves, e.g. in an SSR render. */
  initialMemories?: Memory[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Settings → About me: facts about the person that every bot receives. Unlike a bot's Memory tab,
 * these belong to the whole workspace, so edits and deletes apply everywhere.
 */
export function AboutMeSection({ initialMemories }: AboutMeSectionProps): ReactElement {
  const client = useClient();
  const [memories, setMemories] = useState<Memory[] | null>(initialMemories ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ memory?: Memory } | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  const load = useCallback(async () => {
    try {
      setMemories(await client.listWorkspaceMemories());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setMemories((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: CreateMemory) => {
    await client.createWorkspaceMemory(input);
    await load();
  };

  const update = async (memoryId: string, patch: UpdateMemory) => {
    await client.updateMemory(memoryId, patch);
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium text-ink-2">{t('settings.aboutMeCount', { count: String(memories?.length ?? 0) })}</h3>
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('settings.aboutMeNew')}
        </Button>
      </div>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {memories === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} shape="block" height={72} />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <EmptyState title={t('settings.aboutMeEmptyTitle')} description={t('settings.aboutMeEmptyBody')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {memories.map((memory) => (
            <li key={memory.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{t(MEMORY_KIND_KEY[memory.kind])}</Badge>
                  <time className="text-xs text-ink-3 tabular-nums" dateTime={memory.createdAt}>
                    {memorySavedOnFormat.format(new Date(memory.createdAt))}
                  </time>
                </div>
                <p className="m-0 line-clamp-3 text-sm whitespace-pre-wrap">{memory.content}</p>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ memory })}>
                    {t('settings.aboutMeEdit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(memory)}
                    aria-label={t('settings.aboutMeDeleteNamed', { content: memory.content })}
                    title={t('settings.aboutMeDelete')}
                    className="text-ink-3"
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog !== null} title={t(dialog?.memory ? 'settings.aboutMeEditTitle' : 'settings.aboutMeNewTitle')} onClose={() => setDialog(null)}>
        {dialog !== null ? (
          <MemoryForm memory={dialog.memory} onClose={() => setDialog(null)} onCreate={create} onUpdate={update} />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={t('settings.aboutMeDeleteTitle')}
        description={t('settings.aboutMeDeleteBody')}
        confirmLabel={t('settings.aboutMeDelete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteMemory(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
