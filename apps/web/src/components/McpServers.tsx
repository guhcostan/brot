import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CreateMcpServerInput, McpServer, McpServerTestResult, UpdateMcpServer } from '@brot/protocol';
import { Badge, Button, Skeleton } from '@brot/ui';
import { t } from '../i18n';
import { useClient } from './client';
import { ConfirmDialog } from './Dialog';
import { McpServerDialog } from './McpServerDialog';
import { Pencil, Plus, Trash } from './icons';

export interface McpServersProps {
  /** Servers to render before the client load resolves, e.g. in an SSR render. */
  initialServers?: McpServer[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the handshake said during this session: still running, its tools and latency, or its error. */
type TestState = 'loading' | McpServerTestResult;

/** The stdio invocation, or the http endpoint, as the one-line mono detail under the name. */
function transportDetail(server: McpServer): string {
  return server.transport === 'stdio' ? [server.command ?? '', ...server.args].filter(Boolean).join(' ') : (server.url ?? '');
}

function TestOutcome({ state }: { state: TestState }): ReactElement {
  if (state === 'loading') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-3" aria-live="polite">
        <span aria-hidden="true" className="size-3 animate-spin rounded-full border border-line border-t-ink motion-reduce:animate-none" />
        {t('settings.mcpTesting')}
      </span>
    );
  }
  if (state.ok) {
    return (
      <span className="text-xs text-ink-2" aria-live="polite">
        {t('settings.mcpTestTools', { count: String(state.tools.length), tools: state.tools.join(', ') })} ·{' '}
        {t('settings.mcpTestLatency', { latency: String(state.latencyMs) })}
      </span>
    );
  }
  return (
    <span role="alert" className="text-xs text-attention-text">
      {state.error}
    </span>
  );
}

/**
 * User MCP servers: tool servers every run can call. The test button performs the same handshake a run
 * does, so its result is only known for this session.
 */
export function McpServers({ initialServers }: McpServersProps): ReactElement {
  const client = useClient();
  const [servers, setServers] = useState<McpServer[] | null>(initialServers ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ server?: McpServer } | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setServers(await client.listMcpServers());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setServers((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: CreateMcpServerInput) => {
    await client.createMcpServer(input);
    await load();
  };

  const update = async (serverId: string, patch: UpdateMcpServer) => {
    await client.updateMcpServer(serverId, patch);
    await load();
  };

  const toggleEnabled = async (server: McpServer) => {
    const next = !server.enabled;
    setError(null);
    setServers((current) => (current ?? []).map((entry) => (entry.id === server.id ? { ...entry, enabled: next } : entry)));
    setToggling((current) => new Set(current).add(server.id));
    try {
      const updated = await client.updateMcpServer(server.id, { enabled: next });
      setServers((current) => (current ?? []).map((entry) => (entry.id === server.id ? updated : entry)));
    } catch (cause) {
      setServers((current) => (current ?? []).map((entry) => (entry.id === server.id ? { ...entry, enabled: server.enabled } : entry)));
      setError(messageOf(cause));
    } finally {
      setToggling((current) => {
        const remaining = new Set(current);
        remaining.delete(server.id);
        return remaining;
      });
    }
  };

  const test = async (server: McpServer) => {
    setTests((current) => ({ ...current, [server.id]: 'loading' }));
    try {
      const result = await client.testMcpServer(server.id);
      setTests((current) => ({ ...current, [server.id]: result }));
    } catch (cause) {
      setTests((current) => ({ ...current, [server.id]: { ok: false, error: messageOf(cause) } }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('settings.addMcpServer')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {servers === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} height={70} shape="block" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('settings.mcpServersEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line p-0">
          {servers.map((server) => {
            const testState = tests[server.id];
            return (
              <li key={server.id} className="flex flex-col gap-2 border-b border-line bg-surface px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{server.name}</span>
                      <Badge>{t(server.transport === 'stdio' ? 'settings.mcpBadgeStdio' : 'settings.mcpBadgeHttp')}</Badge>
                    </span>
                    <span className="truncate font-mono text-xs text-ink-2">{transportDetail(server)}</span>
                  </span>
                  <label className="flex flex-none items-center gap-2" htmlFor={`mcp-enabled-${server.id}`}>
                    <span className="brot-sr-only">{t('settings.mcpEnabled')}</span>
                    <input
                      id={`mcp-enabled-${server.id}`}
                      type="checkbox"
                      className="room-check"
                      checked={server.enabled}
                      disabled={toggling.has(server.id)}
                      onChange={() => void toggleEnabled(server)}
                      aria-label={t('settings.mcpToggle', { name: server.name })}
                    />
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ server })} aria-label={t('settings.mcpEditNamed', { name: server.name })} title={t('settings.mcpEditNamed', { name: server.name })}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void test(server)} disabled={testState === 'loading'}>
                    {t('settings.mcpTest')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(server)}
                    aria-label={t('settings.mcpDeleteNamed', { name: server.name })}
                    title={t('settings.mcpDeleteNamed', { name: server.name })}
                    className="text-ink-3"
                  >
                    <Trash size={15} />
                  </Button>
                </div>
                {testState !== undefined ? <TestOutcome state={testState} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      <McpServerDialog open={dialog !== null} server={dialog?.server} onClose={() => setDialog(null)} onCreate={create} onUpdate={update} />
      <ConfirmDialog
        open={deleting !== null}
        title={t('settings.mcpDeleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.mcpDeleteBody')}
        confirmLabel={t('settings.mcpDelete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteMcpServer(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
