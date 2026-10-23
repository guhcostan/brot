// Fake DeepSeek Harness ACP server for dsh.test.ts. Speaks newline-delimited JSON-RPC on stdio
// without the ACP SDK, so the tests check the wire format itself. The scenario is the first word
// of the current message; the rest of that message is the scenario argument.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

if (process.argv.includes('--version')) {
  process.stdout.write('0.2.1-rc.2\n');
  process.exit(0);
}

const MODELS = [
  { value: '["fake","alpha"]', name: 'alpha' },
  { value: '["fake","beta"]', name: 'beta' },
];
const CURRENT_MARKER = 'Current message:\n';
const sessions = new Map();
const awaitingClient = new Map();
let nextRequestId = 1000;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const update = (sessionId, body) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } });

const configOptions = (model) => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: [{ group: 'fake', name: 'Fake', options: MODELS }],
  },
];

function askPermission(sessionId, toolCallId) {
  const id = nextRequestId++;
  send({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
  return new Promise((resolve) => awaitingClient.set(id, resolve));
}

function currentMessage(prompt) {
  const text = prompt.map((block) => block.text ?? '').join('');
  const at = text.lastIndexOf(CURRENT_MARKER);
  if (at !== -1) return text.slice(at + CURRENT_MARKER.length);
  return text.replace(/^\[You are [^\n]*\]\n/, '');
}

async function handlePrompt(id, params) {
  const session = sessions.get(params.sessionId);
  if (session === undefined) return fail(id, -32602, `unknown session: ${params.sessionId}`);
  const sessionId = params.sessionId;
  const text = params.prompt.map((block) => block.text ?? '').join('');
  const [scenario = 'echo', ...rest] = currentMessage(params.prompt).trim().split(/\s+/);
  const argument = rest.join(' ');
  const say = (chunk) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
  const cancelled = new Promise((resolve) => {
    session.onCancel = () => resolve();
  });

  switch (scenario) {
    case 'echo':
      say(`session=${sessionId} pid=${process.pid} model=${session.model} prompt=${text.includes('Current message:') ? 'full' : 'input'} reminder=${text.startsWith('[You are ') ? 'yes' : 'no'}`);
      return respond(id, { stopReason: 'end_turn' });
    case 'blocks': {
      const blocks = params.prompt.map((block) =>
        block.type === 'image'
          ? { type: 'image', mimeType: block.mimeType, data: block.data }
          : { type: 'text', text: block.text },
      );
      say(JSON.stringify(blocks));
      return respond(id, { stopReason: 'end_turn' });
    }
    case 'stream':
      for (const word of argument.split(' ')) say(`${word} `);
      return respond(id, { stopReason: 'end_turn' });
    case 'usage':
      say('counted');
      return respond(id, {
        stopReason: 'end_turn',
        usage: { totalTokens: 46, inputTokens: 12, outputTokens: 34 },
      });
    case 'tool': {
      const toolCallId = 'call-1';
      update(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: 'bash',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: argument },
      });
      const answer = await askPermission(sessionId, toolCallId);
      if (answer.outcome?.outcome === 'selected' && answer.outcome.optionId === 'allow-once') {
        update(sessionId, {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `ran ${argument}` } }],
        });
        say('done');
      } else {
        update(sessionId, {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: 'rejected by agent' } }],
        });
        say(`permission ${answer.outcome?.outcome ?? 'unknown'}`);
      }
      return respond(id, { stopReason: session.cancelRequested ? 'cancelled' : 'end_turn' });
    }
    case 'hang':
      say('partial ');
      await cancelled;
      return respond(id, { stopReason: 'cancelled' });
    case 'ignore-cancel':
      say('stuck ');
      return new Promise(() => undefined);
    case 'crash':
      say('before crash ');
      process.stderr.write('fatal: boom\n');
      setTimeout(() => process.exit(3), 100);
      return undefined;
    case 'mcp':
      say(`mcp=${JSON.stringify(session.mcpServers)} pid=${process.pid} session=${sessionId}`);
      return respond(id, { stopReason: 'end_turn' });
    case 'argv':
      say(`argv=${JSON.stringify(process.argv.slice(2))}`);
      return respond(id, { stopReason: 'end_turn' });
    case 'env':
      say(`token=${process.env.BROT_LLM_TOKEN ?? 'none'} pid=${process.pid} session=${sessionId}`);
      return respond(id, { stopReason: 'end_turn' });
    case 'error':
      return fail(id, -32603, 'model unavailable');
    case 'malformed':
      process.stdout.write('this is not json\n42\n[]\n');
      say('after malformed');
      return respond(id, { stopReason: 'end_turn' });
    default:
      return fail(id, -32602, `unknown scenario: ${scenario}`);
  }
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;
  switch (method) {
    case 'initialize':
      return respond(id, {
        protocolVersion: 1,
        agentInfo: { name: 'fake-dsh-acp', version: '0.0.0' },
        agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
        authMethods: [],
      });
    case 'session/new': {
      const sessionId = randomUUID();
      sessions.set(sessionId, { model: MODELS[0].value, mcpServers: params.mcpServers ?? [] });
      return respond(id, { sessionId, configOptions: configOptions(MODELS[0].value) });
    }
    case 'session/resume': {
      const session = sessions.get(params.sessionId) ?? { model: MODELS[0].value };
      session.mcpServers = params.mcpServers ?? [];
      sessions.set(params.sessionId, session);
      return respond(id, { configOptions: configOptions(session.model) });
    }
    case 'session/set_config_option': {
      const session = sessions.get(params.sessionId);
      if (session === undefined) return fail(id, -32602, `unknown session: ${params.sessionId}`);
      if (params.configId !== 'model' || !MODELS.some((model) => model.value === params.value)) {
        return fail(id, -32602, `unknown model option: ${params.value}`);
      }
      session.model = params.value;
      return respond(id, { configOptions: configOptions(session.model) });
    }
    case 'session/close':
      sessions.delete(params.sessionId);
      return respond(id, {});
    case 'session/prompt':
      return handlePrompt(id, params);
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

function handleNotification(message) {
  if (message.method !== 'session/cancel') return;
  const session = sessions.get(message.params?.sessionId);
  if (session === undefined) return;
  session.cancelRequested = true;
  session.onCancel?.();
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined) {
    const resolve = awaitingClient.get(message.id);
    awaitingClient.delete(message.id);
    resolve?.(message.result);
    return;
  }
  if (message.id === undefined) {
    handleNotification(message);
    return;
  }
  void handleRequest(message);
});
lines.on('close', () => process.exit(0));
