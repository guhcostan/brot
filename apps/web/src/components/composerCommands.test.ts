import { describe, expect, it } from 'vitest';
import { COMMANDS, insertDictation, isValidModelRef, isKnownCommand, parseCommand, suggestCommands } from './composerCommands';

describe('parseCommand', () => {
  it('parses a command and its arguments', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' });
    expect(parseCommand('/rename Weekly plan')).toEqual({ name: 'rename', args: 'Weekly plan' });
    expect(parseCommand('  /model opencode-go/kimi-k2  ')).toEqual({ name: 'model', args: 'opencode-go/kimi-k2' });
    expect(parseCommand('/STOP')).toEqual({ name: 'stop', args: '' });
  });

  it('parses an unknown command so the composer can hint instead of sending', () => {
    expect(parseCommand('/nope')).toEqual({ name: 'nope', args: '' });
    expect(parseCommand('/nope some words')).toEqual({ name: 'nope', args: 'some words' });
  });

  it('leaves ordinary messages alone', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/ hello')).toBeNull();
    expect(parseCommand('a /help')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });
});

describe('command metadata', () => {
  it('knows exactly the five commands', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(['help', 'new', 'rename', 'model', 'stop']);
    expect(isKnownCommand('help')).toBe(true);
    expect(isKnownCommand('nope')).toBe(false);
  });

  it('suggests commands by prefix while the person types a slash', () => {
    expect(suggestCommands('/')).toHaveLength(5);
    expect(suggestCommands('/re').map((command) => command.name)).toEqual(['rename']);
    expect(suggestCommands('/m').map((command) => command.name)).toEqual(['model']);
    expect(suggestCommands('/rename ')).toEqual([]);
    expect(suggestCommands('/zz')).toEqual([]);
  });

  it('validates model refs for the /model command', () => {
    expect(isValidModelRef('opencode-go/kimi-k2')).toBe(true);
    expect(isValidModelRef('provider/model/with/slashes')).toBe(true);
    expect(isValidModelRef('no-slash')).toBe(false);
    expect(isValidModelRef('/model')).toBe(false);
    expect(isValidModelRef('provider/')).toBe(false);
    expect(isValidModelRef('provider/model with space')).toBe(false);
  });
});

describe('insertDictation', () => {
  it('appends at the caret with sensible spacing', () => {
    expect(insertDictation('', 0, 'hello world')).toEqual({ text: 'hello world', caret: 11 });
    expect(insertDictation('Hi', 2, 'there')).toEqual({ text: 'Hi there', caret: 8 });
    expect(insertDictation('Hi ', 3, 'there')).toEqual({ text: 'Hi there', caret: 8 });
    expect(insertDictation('Hi', 0, 'there')).toEqual({ text: 'there Hi', caret: 6 });
  });

  it('ignores blank dictation and clamps a bad caret', () => {
    expect(insertDictation('Hi', 2, '   ')).toEqual({ text: 'Hi', caret: 2 });
    expect(insertDictation('Hi', 999, 'there')).toEqual({ text: 'Hi there', caret: 8 });
  });
});
