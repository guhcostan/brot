import { describe, expect, it } from 'vitest';
import { chooseResponders, resolveMentions } from './routing';

const members = [
  { id: 'capy', name: 'Capy' },
  { id: 'dex', name: 'Dex' },
  { id: 'ana', name: 'Ana' },
  { id: 'anastasia', name: 'Anastasia' },
];

describe('resolveMentions', () => {
  it('finds @Name case-insensitively, in the order the names appear', () => {
    expect(resolveMentions('hey @dex and then @CAPY', members)).toEqual(['dex', 'capy']);
  });

  it('matches whole names only, so a shorter name does not match a longer one', () => {
    expect(resolveMentions('@Anastasia hi', members)).toEqual(['anastasia']);
    expect(resolveMentions('@Ana hi', members)).toEqual(['ana']);
  });

  it('ignores names inside an email address and names that are not members', () => {
    expect(resolveMentions('mail capy@dex.io and @Ghost', members)).toEqual([]);
  });

  it('matches names with spaces and punctuation in them', () => {
    const bots = [{ id: 'r2', name: 'R2.D2 Bot' }];
    expect(resolveMentions('@r2.d2 bot, status?', bots)).toEqual(['r2']);
  });

  it('adds explicit mention ids after the named ones, keeping members only and no duplicates', () => {
    expect(resolveMentions('@Dex hi', members, ['ana', 'dex', 'ghost'])).toEqual(['dex', 'ana']);
  });
});

describe('chooseResponders', () => {
  it('runs the mentioned bots in both modes', () => {
    expect(chooseResponders({ responder: 'mention', mentions: ['dex', 'capy'], leadBotId: 'capy' })).toEqual(['dex', 'capy']);
    expect(chooseResponders({ responder: 'lead', mentions: ['dex'], leadBotId: 'capy', baton: 'ana' })).toEqual(['dex']);
  });

  it('stays silent in mention mode when nobody is mentioned', () => {
    expect(chooseResponders({ responder: 'mention', mentions: [], leadBotId: 'capy', baton: 'ana' })).toEqual([]);
  });

  it('lets the lead bot answer when nobody is mentioned, unless a baton names someone else', () => {
    expect(chooseResponders({ responder: 'lead', mentions: [], leadBotId: 'capy' })).toEqual(['capy']);
    expect(chooseResponders({ responder: 'lead', mentions: [], leadBotId: 'capy', baton: 'ana' })).toEqual(['ana']);
  });
});
