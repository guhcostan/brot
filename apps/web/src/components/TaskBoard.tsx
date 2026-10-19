import { useId, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { Bot, Task, TaskStatus } from '@brot/protocol';
import { Button, EmptyState, TaskStatusLabel } from '@brot/ui';
import { t } from '../i18n';
import { BOARD_COLUMNS, groupByStatus } from '../state/tasks';
import { Board, Plus } from './icons';
import { taskStatusLabel } from './taskLabels';
import { TaskCard } from './Tasks';
import { PaneHeader } from './ThreadView';

export interface TaskBoardProps {
  tasks: Task[];
  bots: Bot[];
  onNewTask: () => void;
  onOpenBots: () => void;
}

/**
 * Who is doing what (PRODUCT.md A8c). One column per status on wide screens; a grouped list on
 * phones. Cancelled tasks get a column only when there are any.
 */
export function TaskBoard({ tasks, bots, onNewTask, onOpenBots }: TaskBoardProps): ReactElement {
  const [assignee, setAssignee] = useState('');
  const filterId = useId();
  const visible = useMemo(() => (assignee ? tasks.filter((task) => task.assigneeBotId === assignee) : tasks), [tasks, assignee]);
  const groups = groupByStatus(visible);
  const columns: TaskStatus[] = groups.cancelled.length > 0 ? [...BOARD_COLUMNS, 'cancelled'] : [...BOARD_COLUMNS];
  const active = tasks.filter((task) => task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked').length;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-labelledby={`${filterId}-title`}>
      <PaneHeader onOpenBots={onOpenBots}>
        <span className="flex size-7 flex-none items-center justify-center text-ink">
          <Board />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 id={`${filterId}-title`} className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">
            {t('board.title')}
          </h1>
          <p className="m-0 truncate text-sm text-ink-2">{t('board.summary', { active: String(active), total: String(tasks.length) })}</p>
        </div>
        <label htmlFor={filterId} className="brot-sr-only">
          {t('board.filter')}
        </label>
        <select
          id={filterId}
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
          className="brot-input hidden !w-auto !min-h-[30px] !py-1 text-sm sm:block"
        >
          <option value="">{t('board.everyone')}</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={onNewTask}>
          <Plus size={14} />
          <span className="hidden sm:inline">{t('board.newTask')}</span>
          <span className="brot-sr-only sm:hidden">{t('board.newTask')}</span>
        </Button>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState title={t('board.emptyTitle')} description={t('board.emptyBody')} />
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-6 px-4 py-6 md:px-6 lg:grid-cols-[repeat(var(--columns),minmax(200px,1fr))] lg:items-start lg:gap-3"
            style={{ '--columns': columns.length } as CSSProperties}
          >
            {columns.map((status) => (
              <section key={status} aria-label={taskStatusLabel(status)} className="flex min-w-0 flex-col gap-2 lg:rounded-lg lg:bg-surface-2 lg:p-2">
                <h2 className="m-0 flex items-center justify-between gap-2 px-1 pt-1 pb-0.5">
                  <TaskStatusLabel status={status} label={taskStatusLabel(status)} className="text-sm" />
                  <span className="text-xs text-ink-3 tabular-nums">{groups[status].length}</span>
                </h2>
                {groups[status].length === 0 ? (
                  <p className="m-0 rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">{t('board.columnEmpty')}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {groups[status].map((task) => (
                      <li key={task.id}>
                        <TaskCard task={task} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
