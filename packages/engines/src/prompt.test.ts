import type { Message } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { buildPrompt, HISTORY_LIMIT, sessionInput, type PromptRoom } from './prompt';
import { testBot } from './test-utils';

const AT = '2026-10-19T12:00:00.000Z';
const IDENTITY = 'You are Test bot, Testing. You are a bot in Brot, working for the user.';

function message(index: number, role: Message['role'], content: string): Message {
  return { id: `m${index}`, threadId: 'thread_1', role, content, createdAt: AT };
}

const room: PromptRoom = {
  title: 'Launch',
  responder: 'lead',
  leadBotId: 'bot_lead',
  members: [
    { id: 'bot_lead', name: 'Tuca', job: 'Developer' },
    { id: 'bot_1', name: 'Onca', job: 'Reviewer' },
  ],
};

describe('buildPrompt', () => {
  it('orders identity, instructions, memories, history and the current message', () => {
    const prompt = buildPrompt({
      bot: { ...testBot, instructions: 'Be brief.' },
      memories: [{ id: 'k1', botId: 'bot_1', kind: 'fact', content: 'Lives in Lisbon', createdAt: AT, updatedAt: AT }],
      history: [message(1, 'user', 'Hi'), message(2, 'assistant', 'Hello')],
      input: 'What is my city?',
    });

    expect(prompt).toBe(
      [
        IDENTITY,
        'Instructions:\nBe brief.',
        'Memories:\n- Lives in Lisbon',
        'Conversation so far:\nUser: Hi\nAssistant: Hello',
        'Current message:\nWhat is my city?',
      ].join('\n\n'),
    );
  });

  it('leaves out empty sections, and still names the bot first', () => {
    expect(buildPrompt({ bot: testBot, memories: [], history: [], input: '- not a flag' })).toBe(
      `${IDENTITY}\n\nCurrent message:\n- not a flag`,
    );
  });

  it('names the bot without a job when the job is empty', () => {
    const prompt = buildPrompt({ bot: { ...testBot, job: ' ' }, memories: [], history: [], input: 'hi' });
    expect(prompt.startsWith('You are Test bot. You are a bot in Brot, working for the user.')).toBe(true);
  });

  it('keeps only the last 20 history messages', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => message(i, 'user', `msg ${i}`));
    const prompt = buildPrompt({ bot: testBot, memories: [], history, input: 'now' });

    expect(prompt).not.toContain('msg 4\n');
    expect(prompt).toContain('User: msg 5\n');
    expect(prompt).toContain(`User: msg ${HISTORY_LIMIT + 4}`);
  });

  it('describes the room: its members with jobs, the lead, the responders, and whose labels are whose', () => {
    const prompt = buildPrompt({ bot: { ...testBot, id: 'bot_1', name: 'Onca', job: 'Reviewer' }, memories: [], history: [], input: 'go', room });

    expect(prompt).toContain('Room "Launch".');
    expect(prompt).toContain('Members: Tuca (Developer), Onca (Reviewer, you).');
    expect(prompt).toContain('Lead: Tuca.');
    expect(prompt).toContain('Responders: mentioned members answer; a message that mentions nobody goes to the lead.');
    expect(prompt).toContain('Messages labeled [Name] were written by that bot; you are Onca.');
    expect(prompt.startsWith('You are Onca, Reviewer. You are a bot in Brot, working for the user.')).toBe(true);
  });

  it('states the mention-only responder mode and leaves the lead out when there is none', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      history: [],
      input: 'go',
      room: { title: 'Ops', responder: 'mention', members: room.members },
    });
    expect(prompt).toContain('Responders: only the members mentioned with @name answer.');
    expect(prompt).not.toContain('Lead:');
  });

  it('adds team guidance only when the team tools are attached', () => {
    const plain = buildPrompt({ bot: testBot, memories: [], history: [], input: 'go' });
    const team = buildPrompt({ bot: testBot, memories: [], history: [], input: 'go', teamTools: true });

    expect(plain).not.toContain('Team tools:');
    expect(team).toContain('Team tools:');
    expect(team).toContain('delegate_task');
    expect(team).toContain('call update_my_task once when it is finished');
    expect(team).toContain('list_team: call it at most once per run.');
  });
});

describe('sessionInput', () => {
  it('sends a direct thread input unchanged', () => {
    expect(sessionInput({ bot: testBot, memories: [], history: [], input: 'next' })).toBe('next');
  });

  it('prefixes a room input with the bot name', () => {
    expect(sessionInput({ bot: testBot, memories: [], history: [], input: 'next', room })).toBe('[You are Test bot]\nnext');
  });
});
