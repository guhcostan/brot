import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createClaudeEngine, claudeFatalLine, parseClaudeLine } from './claude';
import { collect, makeContext, makeFakeCli, removeFakeClis } from './test-utils';

afterAll(removeFakeClis);

const SESSION_FIXTURE = [
  '{"type":"system","subtype":"init","session_id":"s1","tools":["Bash","Read"],"model":"claude-haiku-5-5"}',
  '{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello "}]},"session_id":"s1"}',
  '{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls"}}]},"session_id":"s1"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"a.txt","is_error":false}]},"session_id":"s1"}',
  '{"type":"assistant","message":{"id":"msg_3","role":"assistant","content":[{"type":"text","text":"world"}]},"session_id":"s1"}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"Hello world","session_id":"s1","total_cost_usd":0.0042,"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":100,"output_tokens":7}}',
].join('\n');

describe('parseClaudeLine', () => {
  it('maps each assistant text block to a text delta', () => {
    expect(
      parseClaudeLine(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"},{"type":"text","text":" there"}]}}',
      ),
    ).toEqual([
      { type: 'text.delta', delta: 'Hi' },
      { type: 'text.delta', delta: ' there' },
    ]);
  });

  it('skips assistant messages that carry only tool use or empty text', () => {
    expect(
      parseClaudeLine(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{}}]}}',
      ),
    ).toEqual([]);
    expect(parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":""}]}}')).toEqual([]);
  });

  it('maps the result usage, with cached input counted in tokensIn', () => {
    expect(
      parseClaudeLine(
        '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.0042,"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":100,"output_tokens":7}}',
      ),
    ).toEqual([{ type: 'usage', tokensIn: 115, tokensOut: 7, costUsd: 0.0042 }]);
  });

  it('maps a result that only carries a cost', () => {
    expect(parseClaudeLine('{"type":"result","subtype":"success","total_cost_usd":0.01}')).toEqual([
      { type: 'usage', tokensIn: 0, tokensOut: 0, costUsd: 0.01 },
    ]);
  });

  it('skips system, user, rate-limit and unknown lines', () => {
    expect(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1"}')).toEqual([]);
    expect(parseClaudeLine('{"type":"user","message":{"content":[]}}')).toEqual([]);
    expect(parseClaudeLine('{"type":"rate_limit_event","retry_after":5}')).toEqual([]);
    expect(parseClaudeLine('{"type":"result","subtype":"success"}')).toEqual([]);
  });

  it('skips blank and malformed lines', () => {
    expect(parseClaudeLine('')).toEqual([]);
    expect(parseClaudeLine('not json at all')).toEqual([]);
    expect(parseClaudeLine('{"type":"assistant","message":"oops"}')).toEqual([]);
  });
});

describe('claudeFatalLine', () => {
  it('returns the result text for an error result', () => {
    expect(
      claudeFatalLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key"}'),
    ).toBe('Invalid API key');
  });

  it('returns undefined for successful or unrelated lines', () => {
    expect(claudeFatalLine('{"type":"result","subtype":"success","is_error":false,"result":"ok"}')).toBeUndefined();
    expect(claudeFatalLine('{"type":"assistant","message":{"content":[]}}')).toBeUndefined();
    expect(claudeFatalLine('garbage')).toBeUndefined();
  });
});

describe('createClaudeEngine', () => {
  it('reports unavailable when the binary is missing', async () => {
    const driver = createClaudeEngine({ bin: '/nonexistent/brot-test/claude' });
    expect(driver.id).toBe('claude');
    expect(await driver.detect()).toEqual({ available: false, reason: 'claude CLI not found' });
  });

  it('reports the version from `claude --version`', async () => {
    const bin = await makeFakeCli(() => "process.stdout.write('9.9.9 (Claude Code)\\n');");
    expect(await createClaudeEngine({ bin }).detect()).toEqual({ available: true, version: '9.9.9' });
  });

  it('streams text and usage from the CLI with the expected arguments', async () => {
    const bin = await makeFakeCli(
      (dir) => `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(`${dir}/args.json`)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(`${SESSION_FIXTURE}\n`)});`,
    );
    const { ctx } = makeContext({ input: 'hi', bot: { model: 'opus' } });
    const events = await collect(createClaudeEngine({ bin }).run(ctx));

    expect(events).toEqual([
      { type: 'text.delta', delta: 'Hello ' },
      { type: 'text.delta', delta: 'world' },
      { type: 'usage', tokensIn: 115, tokensOut: 7, costUsd: 0.0042 },
    ]);
  });

  it('passes -p, stream-json, verbose, default permission mode and the model', async () => {
    const bin = await makeFakeCli(
      (dir) => `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(`${dir}/args.json`)}, JSON.stringify(process.argv.slice(2)));`,
    );
    const { ctx } = makeContext({ input: 'hi', bot: { model: 'opus' } });
    await collect(createClaudeEngine({ bin }).run(ctx));

    const args = JSON.parse(await readFile(`${dirname(bin)}/args.json`, 'utf8')) as string[];
    expect(args[0]).toBe('-p');
    expect(args[1]).toContain('Current message:\nhi');
    expect(args.slice(2)).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--model',
      'opus',
    ]);
  });

  it('throws when the CLI reports an error result', async () => {
    const bin = await makeFakeCli(
      () => `process.stdout.write(${JSON.stringify('{"type":"result","is_error":true,"result":"Not logged in"}\n')});`,
    );
    const { ctx } = makeContext({ input: 'hi' });
    await expect(collect(createClaudeEngine({ bin }).run(ctx))).rejects.toThrow('claude run failed: Not logged in');
  });

  it('throws with stderr when the CLI exits non-zero', async () => {
    const bin = await makeFakeCli(() => "process.stderr.write('boom\\n'); process.exit(3);");
    const { ctx } = makeContext({ input: 'hi' });
    await expect(collect(createClaudeEngine({ bin }).run(ctx))).rejects.toThrow('claude exited with code 3: boom');
  });

  it('throws a start error when the binary does not exist', async () => {
    const { ctx } = makeContext({ input: 'hi' });
    const driver = createClaudeEngine({ bin: '/nonexistent/brot-test/claude' });
    await expect(collect(driver.run(ctx))).rejects.toThrow('claude CLI failed to start');
  });

  it('kills the child and returns when aborted mid-run', async () => {
    const bin = await makeFakeCli(
      () => `
process.stdout.write(${JSON.stringify('{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}\n')});
setInterval(() => undefined, 1000);`,
    );
    const controller = new AbortController();
    const { ctx } = makeContext({ input: 'hi', signal: controller.signal });
    const events: string[] = [];
    const started = Date.now();
    for await (const event of createClaudeEngine({ bin }).run(ctx)) {
      events.push(event.type);
      controller.abort();
    }

    expect(events).toEqual(['text.delta']);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
