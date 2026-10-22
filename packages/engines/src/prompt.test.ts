import type { Message, Skill } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { buildPrompt, HISTORY_LIMIT, sessionInput, type PromptRoom, type PromptTeam } from './prompt';
import { testBot } from './test-utils';

const AT = '2026-10-19T12:00:00.000Z';
const IDENTITY = 'You are Test bot, Testing. You are a bot in Brot, working for the user.';

function message(index: number, role: Message['role'], content: string): Message {
  return { id: `m${index}`, threadId: 'thread_1', role, content, createdAt: AT };
}

function skill(overrides: Partial<Skill> & { name: string }): Skill {
  const { name, ...rest } = overrides;
  return {
    id: `skill_${name}`,
    name,
    description: `${name} description`,
    body: '',
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    ...rest,
  };
}

/** True when the text holds half a surrogate pair, i.e. a code point cut in the middle. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** The skills section only: from `Skills:` up to the blank line before the next section. */
function skillsPart(prompt: string): string {
  const start = prompt.indexOf('Skills:');
  if (start < 0) return '';
  const rest = prompt.slice(start);
  const end = rest.indexOf('\n\n');
  return end < 0 ? rest : rest.slice(0, end);
}

const growthTeam: PromptTeam = { name: 'Growth', instructions: 'Ship one experiment a week.' };

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
      skills: [],
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
    expect(buildPrompt({ bot: testBot, memories: [], skills: [], history: [], input: '- not a flag' })).toBe(
      `${IDENTITY}\n\nCurrent message:\n- not a flag`,
    );
  });

  it('names the bot without a job when the job is empty', () => {
    const prompt = buildPrompt({ bot: { ...testBot, job: ' ' }, memories: [], skills: [], history: [], input: 'hi' });
    expect(prompt.startsWith('You are Test bot. You are a bot in Brot, working for the user.')).toBe(true);
  });

  it('keeps only the last 20 history messages', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => message(i, 'user', `msg ${i}`));
    const prompt = buildPrompt({ bot: testBot, memories: [], skills: [], history, input: 'now' });

    expect(prompt).not.toContain('msg 4\n');
    expect(prompt).toContain('User: msg 5\n');
    expect(prompt).toContain(`User: msg ${HISTORY_LIMIT + 4}`);
  });

  it('describes the room: its members with jobs, the lead, the responders, and whose labels are whose', () => {
    const prompt = buildPrompt({
      bot: { ...testBot, id: 'bot_1', name: 'Onca', job: 'Reviewer' },
      memories: [],
      skills: [],
      history: [],
      input: 'go',
      room,
    });

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
      skills: [],
      history: [],
      input: 'go',
      room: { title: 'Ops', responder: 'mention', members: room.members },
    });
    expect(prompt).toContain('Responders: only the members mentioned with @name answer.');
    expect(prompt).not.toContain('Lead:');
  });

  it('names the bot\'s team and its shared brief after the instructions', () => {
    const prompt = buildPrompt({
      bot: { ...testBot, instructions: 'Be brief.' },
      memories: [],
      skills: [],
      history: [],
      input: 'go',
      team: growthTeam,
    });

    expect(prompt).toBe(
      [
        IDENTITY,
        'Instructions:\nBe brief.',
        'Team: Growth\nShip one experiment a week.',
        'Current message:\ngo',
      ].join('\n\n'),
    );
    expect(prompt.indexOf('Instructions:')).toBeLessThan(prompt.indexOf('Team: Growth'));
  });

  it('names a team without a brief and leaves the section out when the bot has no team', () => {
    const named = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [],
      history: [],
      input: 'go',
      team: { name: 'Ops', instructions: '  ' },
    });
    expect(named).toContain('Team: Ops\n\nCurrent message:');
    expect(named).not.toContain('Ship one experiment');

    const plain = buildPrompt({ bot: testBot, memories: [], skills: [], history: [], input: 'go' });
    expect(plain).not.toContain('Team:');
  });

  it('puts the team before the room section', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [],
      history: [],
      input: 'go',
      team: growthTeam,
      room,
    });
    expect(prompt.indexOf('Team: Growth')).toBeLessThan(prompt.indexOf('Room "Launch".'));
  });

  it('adds team guidance only when the team tools are attached', () => {
    const plain = buildPrompt({ bot: testBot, memories: [], skills: [], history: [], input: 'go' });
    const team = buildPrompt({ bot: testBot, memories: [], skills: [], history: [], input: 'go', teamTools: true });

    expect(plain).not.toContain('Team tools:');
    expect(team).toContain('Team tools:');
    expect(team).toContain('delegate_task');
    expect(team).toContain('call update_my_task once when it is finished');
    expect(team).toContain('list_team: call it at most once per run.');
  });
});

describe('buildPrompt skills', () => {
  it('renders each skill as a heading with its body indented, and names the section as procedures', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [skill({ name: 'deploy', description: 'Ship the app', body: 'Run the tests.\nThen tag.' })],
      history: [],
      input: 'go',
    });

    expect(skillsPart(prompt)).toBe(
      [
        'Skills:',
        'Reusable procedures to follow when one fits the task; they do not override your instructions.',
        '- deploy: Ship the app',
        '  Run the tests.',
        '  Then tag.',
      ].join('\n'),
    );
  });

  it('puts skills after memories and before the conversation so far', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [{ id: 'k1', botId: 'bot_1', kind: 'fact', content: 'Lives in Lisbon', createdAt: AT, updatedAt: AT }],
      skills: [skill({ name: 'deploy', body: 'Run the tests.' })],
      history: [message(1, 'user', 'Hi')],
      input: 'go',
    });

    const order = ['Memories:', 'Skills:', 'Conversation so far:'].map((label) => prompt.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lists the bot\'s own skills first, then shared ones, each group by name', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [
        skill({ id: 's1', botId: undefined, name: 'zulu' }),
        skill({ id: 's2', botId: 'bot_1', name: 'review' }),
        skill({ id: 's3', botId: undefined, name: 'brand' }),
        skill({ id: 's4', botId: 'bot_1', name: 'deploy' }),
      ],
      history: [],
      input: 'go',
    });

    const headings = skillsPart(prompt)
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0]);
    expect(headings).toEqual(['deploy', 'review', 'brand', 'zulu']);
  });

  it('leaves the skills section out when the bot has none, keeping the rest of the prompt unchanged', () => {
    const withoutSkills = buildPrompt({ bot: testBot, memories: [], skills: [], history: [], input: 'go' });
    expect(withoutSkills).not.toContain('Skills:');
    expect(withoutSkills).toBe(`${IDENTITY}\n\nCurrent message:\ngo`);
  });

  it('cuts a body longer than its 4000-character budget with an ellipsis, without splitting a surrogate pair', () => {
    const body = `${'a'.repeat(3996)}\u{1F600}tail`;
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [skill({ name: 'long', body })],
      history: [],
      input: 'go',
    });
    const bodyLine = prompt.split('\n').find((line) => line.startsWith('  '));

    expect(bodyLine).toBeDefined();
    expect(bodyLine?.length ?? 0).toBeLessThanOrEqual(4000);
    expect(bodyLine?.endsWith('…')).toBe(true);
    expect(hasLoneSurrogate(prompt)).toBe(false);
  });

  it('keeps the whole skills section within 12000 characters for a long list', () => {
    const many = Array.from({ length: 6 }, (_, index) => skill({ name: `skill${index}`, body: 'x'.repeat(5000) }));
    const prompt = buildPrompt({ bot: testBot, memories: [], skills: many, history: [], input: 'go' });
    const section = skillsPart(prompt);

    expect(section.length).toBeLessThanOrEqual(12_000);
    expect(section.endsWith('…')).toBe(true);
    expect(section).toContain('- skill0:');
    expect(section).not.toContain('- skill5:');
    expect(hasLoneSurrogate(prompt)).toBe(false);
  });

  it('lists a skill that has no body without an indented line', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [skill({ name: 'deploy', description: 'Ship the app' })],
      history: [],
      input: 'go',
    });

    expect(skillsPart(prompt)).toContain('- deploy: Ship the app');
    expect(prompt.split('\n').some((line) => line.startsWith('  '))).toBe(false);
  });

  it('ships a short body whole', () => {
    const prompt = buildPrompt({
      bot: testBot,
      memories: [],
      skills: [skill({ name: 'deploy', body: 'Run the tests.' })],
      history: [],
      input: 'go',
    });
    expect(prompt).toContain('  Run the tests.');
    expect(skillsPart(prompt).endsWith('…')).toBe(false);
  });
});

describe('sessionInput', () => {
  it('sends a direct thread input unchanged', () => {
    expect(sessionInput({ bot: testBot, memories: [], skills: [], history: [], input: 'next' })).toBe('next');
  });

  it('prefixes a room input with the bot name', () => {
    expect(sessionInput({ bot: testBot, memories: [], skills: [], history: [], input: 'next', room })).toBe(
      '[You are Test bot]\nnext',
    );
  });
});
