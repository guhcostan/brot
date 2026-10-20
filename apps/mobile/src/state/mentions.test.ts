import { describe, expect, it } from 'vitest';
import { activeMention, findMentions, insertMention, matchMembers, splitMentions } from './mentions';

const members = [
  { id: 'bot_capy', name: 'Capy' },
  { id: 'bot_onca', name: 'Onça' },
  { id: 'bot_tuca', name: 'Tuca' },
];

describe('mentions', () => {
  it('finds members by name, case-insensitively, once each, in order', () => {
    expect(findMentions('@onça and @Capy, then @Onça again; @Nobody', members)).toEqual(['bot_onca', 'bot_capy']);
  });

  it('splits text around known mentions only', () => {
    expect(splitMentions('Hi @Tuca, cc @Zed', members)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', text: '@Tuca', botId: 'bot_tuca' },
      { kind: 'text', text: ', cc @Zed' },
    ]);
  });

  it('opens on @ at a word start, not inside an email', () => {
    expect(activeMention('ask @On', 7)).toEqual({ start: 4, query: 'On' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('ana@acme', 8)).toBeNull();
    expect(activeMention('@Capy done', 10)).toBeNull();
  });

  it('ranks prefix matches before substring matches', () => {
    expect(matchMembers(members, 'ca').map((member) => member.name)).toEqual(['Capy', 'Tuca']);
  });

  it('inserts the full name with one trailing space', () => {
    expect(insertMention('hey @ca there', { start: 4, query: 'ca' }, 'Capy')).toEqual({ text: 'hey @Capy there', caret: 10 });
  });
});
