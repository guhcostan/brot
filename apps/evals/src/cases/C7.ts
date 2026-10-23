import { check, info } from '../checks';
import type { Case } from '../types';
import { botSpec, eventsOfType, fixturePath, isTool, readFixture } from './shared';

const MAGIC = readFixture('c7/acme-magic.txt').trim();

/**
 * A user MCP server launched as a local stdio child, granted to one bot whose egress mode is deny. The bot must call
 * the server's read-only tool and quote its value, proving the attach needs no tunnel and no network allowlist.
 */
export const C7: Case = {
  id: 'C7',
  title: 'Localhost MCP server attached to a bot, without a tunnel',
  status: 'now',
  note: 'The eval starts a stdio MCP fixture on the server machine, grants it to one bot with egress deny, and asks the bot to call acme_lookup and report its value.',
  egress: [],
  async setup(ctx) {
    const server = await ctx.createMcpServer({
      name: `acme-${ctx.settings.caseId.toLowerCase()}-${Date.now().toString(36)}`,
      transport: 'stdio',
      command: 'node',
      args: [fixturePath('c7/acme-mcp.mjs')],
      enabled: true,
    });
    ctx.notes.c7McpServer = server.id;
    ctx.notes.c7McpName = server.name;
    await ctx.createBot('capy', {
      ...botSpec(
        'capy',
        'Account assistant with a local MCP server',
        'You use the tools you are given. When asked to look up Acme, call the acme_lookup tool and report the exact value it returns, then stop.',
        [],
      ),
      computer: 'none',
      mcpServerIds: [server.id],
    });
    const created = await ctx.api.bot(ctx.botRef('capy').id);
    ctx.notes.c7Egress = created.egress?.mode ?? 'none';
  },
  async run(ctx) {
    await ctx.sayAndWait('capy:dm', `Call the acme_lookup tool and reply with the exact value it returns. Do not guess.`);
  },
  check(evidence) {
    const botId = evidence.bots.capy?.id;
    const runs = evidence.runs.filter((run) => run.botId === botId);
    const completed = runs.some((run) => run.status === 'completed');
    const toolCalls = eventsOfType(evidence, 'tool.call');
    const mcpCalls = toolCalls.filter((event) => isTool('acme_lookup', event.tool));
    const toolNames = [...new Set(toolCalls.map((event) => event.tool))].join(', ') || 'none';
    const text = evidence.finalTexts
      .filter((entry) => entry.botKey === 'capy')
      .map((entry) => entry.text)
      .join('\n');
    const approvals = evidence.approvals.filter((record) => record.botKey === 'capy');
    const unrecorded = evidence.unrecordedApprovals ?? [];
    return [
      check('run-completed', 'The bot’s run completed', completed, runs.map((run) => run.status).join(', ') || 'no run'),
      check(
        'mcp-tool-called',
        'A tool.call for the MCP tool acme_lookup appears in the run’s events',
        mcpCalls.length > 0,
        mcpCalls.length > 0 ? `called: ${mcpCalls.map((event) => event.tool).join(', ')}` : `tools seen: ${toolNames}`,
      ),
      check('magic-in-reply', 'The bot’s final text contains the value the MCP server returned', text.includes(MAGIC), text.includes(MAGIC) ? MAGIC : text.slice(0, 300) || 'no reply'),
      check(
        'egress-stayed-deny',
        'The bot kept the deny-all egress policy (the attach needs no tunnel and no allowlist)',
        evidence.notes.c7Egress === 'deny',
        String(evidence.notes.c7Egress ?? 'unknown'),
      ),
      check(
        'no-approval-needed',
        'The read-only MCP tool needed no approval; nothing was resolved outside the runner',
        approvals.length === 0 && unrecorded.length === 0,
        approvals.length === 0 ? 'no approval on the case' : approvals.map((record) => record.summary).join('; '),
      ),
      info(
        'mcp-server',
        'User MCP server attached to the bot',
        `${String(evidence.notes.c7McpName ?? 'unknown')} (${String(evidence.notes.c7McpServer ?? 'unknown')}), egress ${String(evidence.notes.c7Egress ?? 'unknown')}`,
      ),
    ];
  },
  async cleanup(ctx) {
    // The runner deletes the tracked MCP server; this hook only drops the bots so none is archived.
    for (const bot of ctx.bots.values()) await ctx.api.deleteBot(bot.id).catch(() => undefined);
    ctx.bots.clear();
  },
};
