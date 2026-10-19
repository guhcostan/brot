import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { TEAM_MAX_DEPTH, type Bot, type Task } from '@brot/protocol';
import { Badge, Button, Input, StatusDot, TaskStatusLabel, Textarea, cx } from '@brot/ui';
import type { NewTask } from '../data/client';
import { formatTime } from '../format';
import { t } from '../i18n';
import { ancestorsOf, childrenOf, isTerminal } from '../state/tasks';
import { Dialog } from './Dialog';
import { taskStatusLabel } from './taskLabels';
import { TeamAvatar, useBotName, useTeam } from './team';

/** The assignee's face for a task's state: working while in progress, concerned when failed. */
function taskMood(task: Task) {
  if (task.status === 'in_progress') return 'thinking' as const;
  if (task.status === 'failed') return 'error' as const;
  if (task.status === 'blocked') return 'approval' as const;
  if (task.status === 'cancelled') return 'sleeping' as const;
  return 'idle' as const;
}

/** Filled dots for how deep in its chain a task sits. Depth 0 is a task you created. */
export function DepthDots({ depth }: { depth: number }): ReactElement | null {
  if (depth === 0) return null;
  const label = t('task.depth', { depth: String(depth), max: String(TEAM_MAX_DEPTH) });
  return (
    <span className="inline-flex flex-none items-center gap-[3px]" role="img" aria-label={label} title={label}>
      {Array.from({ length: TEAM_MAX_DEPTH }, (_, index) => (
        <span
          key={index}
          className={cx('size-[5px] rounded-full', index < depth ? 'bg-ink-2' : 'border border-ink-3 bg-transparent')}
        />
      ))}
    </span>
  );
}

/** Root → … → parent, as plain text. */
export function ChainCrumbs({ task, className }: { task: Task; className?: string }): ReactElement | null {
  const { tasks } = useTeam();
  const chain = ancestorsOf(tasks, task);
  if (chain.length === 0) return null;
  return (
    <span className={cx('flex min-w-0 items-center gap-1 text-xs text-ink-3', className)}>
      <span className="brot-sr-only">{t('task.chain')}</span>
      {chain.map((parent, index) => (
        <span key={parent.id} className={cx('flex min-w-0 items-center gap-1', index < chain.length - 1 && 'flex-shrink-[2]')}>
          <span className="truncate">{parent.title}</span>
          <span aria-hidden="true" className="flex-none">
            ›
          </span>
        </span>
      ))}
    </span>
  );
}

/** Whether a blocked task's assignee is waiting on a human approval right now. */
function useWaitsForYou(): (task: Task) => boolean {
  const { waitingBots } = useTeam();
  return (task) => task.status === 'blocked' && waitingBots.has(task.assigneeBotId);
}

export function TaskCard({ task, compact = false }: { task: Task; compact?: boolean }): ReactElement {
  const { openTask } = useTeam();
  const nameOf = useBotName();
  const waitsForYou = useWaitsForYou()(task);
  const assignee = nameOf(task.assigneeBotId);
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      data-avatar-zone
      className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <TeamAvatar botId={task.assigneeBotId} size={20} mood={taskMood(task)} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">{assignee}</span>
        <DepthDots depth={task.depth} />
        {compact ? <TaskStatusLabel status={task.status} label={taskStatusLabel(task.status)} /> : null}
      </span>
      <ChainCrumbs task={task} className="-mb-1 w-full" />
      <span className="text-sm leading-snug font-medium text-ink">{task.title}</span>
      {task.result ? <span className="line-clamp-2 text-xs text-ink-2">{task.result}</span> : null}
      {waitsForYou ? <StatusDot status="waiting" label={t('task.waitingYou')} /> : null}
      <span className="flex w-full items-center justify-between gap-2 text-xs text-ink-3">
        <span className="truncate">{task.createdByBotId ? t('task.from', { name: nameOf(task.createdByBotId) }) : t('task.fromYou')}</span>
        <time className="flex-none tabular-nums">{formatTime(task.updatedAt)}</time>
      </span>
    </button>
  );
}

/** A compact list for the context panel's Tasks tab. */
export function TaskList({ tasks, empty }: { tasks: Task[]; empty: string }): ReactElement {
  if (tasks.length === 0) return <p className="m-0 py-6 text-center text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskCard task={task} compact />
        </li>
      ))}
    </ul>
  );
}

export interface TaskDetailProps {
  taskId: string | null;
  onClose: () => void;
  onCancel: (taskId: string) => Promise<unknown>;
}

export function TaskDetailDialog({ taskId, onClose, onCancel }: TaskDetailProps): ReactElement {
  const { tasks } = useTeam();
  const task = taskId ? tasks[taskId] : undefined;
  return (
    <Dialog open={task !== undefined} title={task?.title ?? ''} onClose={onClose} size="md">
      {task ? <TaskDetail task={task} onClose={onClose} onCancel={onCancel} /> : null}
    </Dialog>
  );
}

function TaskDetail({ task, onClose, onCancel }: { task: Task; onClose: () => void; onCancel: (taskId: string) => Promise<unknown> }): ReactElement {
  const { tasks, rooms, openBot, openRoom, openTask } = useTeam();
  const nameOf = useBotName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chain = ancestorsOf(tasks, task);
  const children = childrenOf(tasks, task.id);
  const room = rooms.find((entry) => entry.thread.id === task.threadId);
  const waitsForYou = useWaitsForYou()(task);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCancel(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const goWork = () => {
    onClose();
    openBot(task.assigneeBotId);
  };
  const goRequested = () => {
    onClose();
    if (room) openRoom(room.thread.id);
    else if (task.createdByBotId) openBot(task.createdByBotId);
    else openBot(task.assigneeBotId);
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-4 pb-5">
      <div className="flex flex-wrap items-center gap-3">
        <TaskStatusLabel status={task.status} label={taskStatusLabel(task.status)} className="text-sm" />
        {waitsForYou ? <StatusDot status="waiting" label={t('task.waitingYou')} /> : null}
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <DepthDots depth={task.depth} />
          {task.depth > 0 ? t('task.depth', { depth: String(task.depth), max: String(TEAM_MAX_DEPTH) }) : t('task.root')}
        </span>
      </div>

      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-2">{t('task.assignee')}</dt>
        <dd className="m-0 flex items-center gap-2">
          <TeamAvatar botId={task.assigneeBotId} size={20} mood={taskMood(task)} />
          <span className="font-medium">{nameOf(task.assigneeBotId)}</span>
        </dd>
        <dt className="text-ink-2">{t('task.createdBy')}</dt>
        <dd className="m-0 flex items-center gap-2">
          {task.createdByBotId ? (
            <>
              <TeamAvatar botId={task.createdByBotId} size={20} />
              <span>{nameOf(task.createdByBotId)}</span>
            </>
          ) : (
            <span>{t('task.you')}</span>
          )}
        </dd>
        <dt className="text-ink-2">{t('task.requestedIn')}</dt>
        <dd className="m-0 truncate">{room ? room.thread.title : t('task.dmWith', { name: nameOf(task.createdByBotId ?? task.assigneeBotId) })}</dd>
        <dt className="text-ink-2">{t('task.updated')}</dt>
        <dd className="m-0 tabular-nums">{formatTime(task.updatedAt)}</dd>
      </dl>

      {chain.length > 0 ? (
        <nav aria-label={t('task.chain')} className="flex flex-col gap-1.5">
          <h3 className="m-0 text-xs font-medium text-ink-2">{t('task.chain')}</h3>
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm">
            {chain.map((parent) => (
              <li key={parent.id} className="flex items-center gap-1">
                <button type="button" onClick={() => openTask(parent.id)} className="rounded-sm underline decoration-line underline-offset-4 hover:decoration-ink">
                  {parent.title}
                </button>
                <span aria-hidden="true" className="text-ink-3">
                  ›
                </span>
              </li>
            ))}
            <li aria-current="true" className="font-medium">
              {task.title}
            </li>
          </ol>
        </nav>
      ) : null}

      {task.description ? (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-xs font-medium text-ink-2">{t('task.description')}</h3>
          <p className="m-0 text-sm whitespace-pre-wrap">{task.description}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <h3 className="m-0 text-xs font-medium text-ink-2">{t('task.result')}</h3>
        <p className={cx('m-0 text-sm whitespace-pre-wrap', !task.result && 'text-ink-3')}>{task.result ?? t('task.noResult')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 flex items-center gap-2 text-xs font-medium text-ink-2">
          {t('task.children')} <Badge>{children.length}</Badge>
        </h3>
        {children.length === 0 ? (
          <p className="m-0 text-sm text-ink-3">{t('task.noChildren')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => openTask(child.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <TeamAvatar botId={child.assigneeBotId} size={18} mood={taskMood(child)} />
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  <TaskStatusLabel status={child.status} label={taskStatusLabel(child.status)} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {isTerminal(task.status) ? null : (
          <Button variant="secondary" onClick={() => void cancel()} disabled={busy}>
            {t('task.cancel')}
          </Button>
        )}
        <Button variant="secondary" onClick={goRequested}>
          {room ? t('task.openRoom') : t('task.openRequested')}
        </Button>
        <Button variant="primary" onClick={goWork} disabled={task.workThreadId === undefined}>
          {t('task.openWork', { name: nameOf(task.assigneeBotId) })}
        </Button>
      </div>
    </div>
  );
}

export interface CreateTaskDialogProps {
  open: boolean;
  bots: Bot[];
  /** Preselects the assignee, e.g. the bot whose panel is open. */
  defaultAssigneeId?: string;
  /** The room the task is requested in. Absent means the assignee's DM. */
  room?: { id: string; title: string; memberIds: string[] };
  onClose: () => void;
  onCreate: (input: NewTask) => Promise<unknown>;
}

export function CreateTaskDialog(props: CreateTaskDialogProps): ReactElement {
  return (
    <Dialog open={props.open} title={t('newTask.title')} description={props.room ? t('newTask.inRoom', { title: props.room.title }) : t('newTask.description')} onClose={props.onClose}>
      {props.open ? <CreateTaskForm {...props} /> : null}
    </Dialog>
  );
}

function CreateTaskForm({ bots, defaultAssigneeId, room, onClose, onCreate }: CreateTaskDialogProps): ReactElement {
  const choices = bots.filter((bot) => !bot.archived && (!room || room.memberIds.includes(bot.id)));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState(
    defaultAssigneeId && choices.some((bot) => bot.id === defaultAssigneeId) ? defaultAssigneeId : (choices[0]?.id ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const assigneeId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!title.trim() || !assignee || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        assigneeBotId: assignee,
        ...(room ? { roomId: room.id } : {}),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      <Input
        label={t('newTask.name')}
        placeholder={t('newTask.namePlaceholder')}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={tried && !title.trim() ? t('newTask.nameRequired') : undefined}
        autoFocus
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={assigneeId} className="text-sm font-medium">
          {t('newTask.assignee')}
        </label>
        <select id={assigneeId} value={assignee} onChange={(event) => setAssignee(event.target.value)} className="brot-input">
          {choices.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name} · {bot.job}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        label={t('newTask.details')}
        hint={t('newTask.detailsHint')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('newTask.create')}
        </Button>
      </div>
    </form>
  );
}
