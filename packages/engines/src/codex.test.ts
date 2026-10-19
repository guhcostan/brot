import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { codexFatalLine, createCodexEngine, parseCodexLine } from './codex';
import { collect, makeContext, makeFakeCli, removeFakeClis } from './test-utils';

afterAll(removeFakeClis);

const RUN_FIXTURE = [
  '{"type":"thread.started","thread_id":"0199a213-81c0-7b13-b8f7-5a4d0c1e0001"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","aggregated_output":"a.txt\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Found"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Found a.txt."}}',
  '{"type":"turn.completed","usage":{"input_tokens":2048,"cached_input_tokens":1024,"output_tokens":12,"reasoning_output_tokens":3}}',
].join('\n');

describe('parseCodexLine', () => {
  it('maps a completed agent message to a text delta', () => {
    expect(
      parseCodexLine('{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Found a.txt."}}'),
    ).toEqual([{ type: 'text.delta', delta: 'Found a.txt.' }]);
  });

  it('maps turn usage, with no cost reported by Codex', () => {
    expect(
      parseCodexLine(
        '{"type":"turn.completed","usage":{"input_tokens":2048,"cached_input_tokens":1024,"output_tokens":12,"reasoning_output_tokens":3}}',
      ),
    ).toEqual([{ type: 'usage', tokensIn: 2048, tokensOut: 12, costUsd: 0 }]);
  });

  it('skips in-progress items, command output and session events', () => {
    expect(
      parseCodexLine(
        '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Found"}}',
      ),
    ).toEqual([]);
    expect(
      parseCodexLine(
        '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"ls","aggregated_output":"a","exit_code":0,"status":"completed"}}',
      ),
    ).toEqual([]);
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual([]);
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual([]);
    expect(parseCodexLine('{"type":"error","message":"Reconnecting... 2/5"}')).toEqual([]);
  });

  it('skips blank and malformed lines', () => {
    expect(parseCodexLine('')).toEqual([]);
    expect(parseCodexLine('{"type":"turn.completed"}')).toEqual([]);
    expect(parseCodexLine('<html>')).toEqual([]);
  });
});

describe('codexFatalLine', () => {
  it('returns the message when a turn fails', () => {
    expect(codexFatalLine('{"type":"turn.failed","error":{"message":"rate limited"}}')).toBe('rate limited');
  });

  it('treats only turn.failed as fatal', () => {
    expect(codexFatalLine('{"type":"error","message":"Reconnecting... 2/5"}')).toBeUndefined();
    expect(codexFatalLine('{"type":"turn.completed","usage":{}}')).toBeUndefined();
  });
});

describe('createCodexEngine', () => {
  it('reports unavailable when the binary is missing', async () => {
    const driver = createCodexEngine({ bin: '/nonexistent/brot-test/codex' });
    expect(driver.id).toBe('codex');
    expect(await driver.detect()).toEqual({ available: false, reason: 'codex CLI not found' });
  });

  it('reports the version from `codex --version`', async () => {
    const bin = await makeFakeCli(() => "process.stdout.write('codex-cli 0.160.1\\n');");
    expect(await createCodexEngine({ bin }).detect()).toEqual({ available: true, version: '0.160.1' });
  });

  it('streams the agent message and usage from `codex exec --json`', async () => {
    const bin = await makeFakeCli(
      (dir) => `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(`${dir}/args.json`)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(`${RUN_FIXTURE}\n`)});`,
    );
    const { ctx } = makeContext({ input: 'list files' });
    const events = await collect(createCodexEngine({ bin }).run(ctx));

    expect(events).toEqual([
      { type: 'text.delta', delta: 'Found a.txt.' },
      { type: 'usage', tokensIn: 2048, tokensOut: 12, costUsd: 0 },
    ]);
  });

  it('runs exec with --json and the prompt as the final argument', async () => {
    const bin = await makeFakeCli(
      (dir) => `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(`${dir}/args.json`)}, JSON.stringify(process.argv.slice(2)));`,
    );
    const { ctx } = makeContext({ input: 'list files' });
    await collect(createCodexEngine({ bin }).run(ctx));

    const args = JSON.parse(await readFile(`${dirname(bin)}/args.json`, 'utf8')) as string[];
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args.at(-1)).toContain('Current message:\nlist files');
  });

  it('throws when a turn fails', async () => {
    const bin = await makeFakeCli(
      () =>
        `process.stdout.write(${JSON.stringify('{"type":"turn.failed","error":{"message":"quota exceeded"}}\n')});`,
    );
    const { ctx } = makeContext({ input: 'hi' });
    await expect(collect(createCodexEngine({ bin }).run(ctx))).rejects.toThrow('codex run failed: quota exceeded');
  });

  it('throws a start error when the binary does not exist', async () => {
    const { ctx } = makeContext({ input: 'hi' });
    const driver = createCodexEngine({ bin: '/nonexistent/brot-test/codex' });
    await expect(collect(driver.run(ctx))).rejects.toThrow('codex CLI failed to start');
  });
});
