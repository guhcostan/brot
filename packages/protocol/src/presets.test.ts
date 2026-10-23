import { describe, expect, it } from 'vitest';
import {
  BotPreset,
  BotPresetAvatar,
  CreateBotPreset,
  CreatePresetFromBot,
  UpdateBotPreset,
  type BotPreset as BotPresetValue,
} from './presets';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const preset = {
  id: 'preset_1',
  name: 'Researcher',
  job: 'Reads and summarises',
  instructions: 'Be precise.',
  avatar: 'capivara:black',
  createdAt: at,
  updatedAt: at,
};

describe('BotPreset', () => {
  it('round-trips through JSON with and without an avatar', () => {
    expect(roundTrip(BotPreset, preset)).toEqual(preset);
    const bare: BotPresetValue = { ...preset, avatar: undefined };
    const parsed = roundTrip(BotPreset, bare);
    expect(parsed.avatar).toBeUndefined();
    expect(parsed.id).toBe('preset_1');
  });

  it('rejects a preset without its required fields', () => {
    expect(() => BotPreset.parse({ ...preset, name: undefined })).toThrow();
    expect(() => BotPreset.parse({ ...preset, createdAt: 'yesterday' })).toThrow();
  });
});

describe('BotPresetAvatar', () => {
  it('accepts species:color values, including legacy shape names', () => {
    expect(BotPresetAvatar.parse('capivara:black')).toBe('capivara:black');
    expect(BotPresetAvatar.parse('circle:black')).toBe('circle:black');
    expect(BotPresetAvatar.parse('sky-blue:violet')).toBe('sky-blue:violet');
  });

  it('rejects other values, empty parts, and long values', () => {
    expect(() => BotPresetAvatar.parse('ada.png')).toThrow();
    expect(() => BotPresetAvatar.parse(':black')).toThrow();
    expect(() => BotPresetAvatar.parse('capivara:')).toThrow();
    expect(() => BotPresetAvatar.parse(`${'a'.repeat(60)}:black`)).toThrow();
  });
});

describe('CreateBotPreset', () => {
  it('defaults instructions to empty and keeps the optional avatar', () => {
    expect(CreateBotPreset.parse({ name: 'Researcher', job: 'Reads' })).toEqual({
      name: 'Researcher',
      job: 'Reads',
      instructions: '',
    });
    expect(CreateBotPreset.parse({ name: 'Researcher', job: 'Reads', instructions: 'Be brief.', avatar: 'onca:blue' })).toEqual(
      { name: 'Researcher', job: 'Reads', instructions: 'Be brief.', avatar: 'onca:blue' },
    );
  });

  it('caps names, instructions and the avatar', () => {
    expect(() => CreateBotPreset.parse({ name: '', job: 'Reads' })).toThrow();
    expect(() => CreateBotPreset.parse({ name: 'x'.repeat(121), job: 'Reads' })).toThrow();
    expect(() => CreateBotPreset.parse({ name: 'R', job: '' })).toThrow();
    expect(() => CreateBotPreset.parse({ name: 'R', job: 'x'.repeat(121) })).toThrow();
    expect(CreateBotPreset.parse({ name: 'R', job: 'J', instructions: 'x'.repeat(20_000) })).toBeTruthy();
    expect(() => CreateBotPreset.parse({ name: 'R', job: 'J', instructions: 'x'.repeat(20_001) })).toThrow();
    expect(() => CreateBotPreset.parse({ name: 'R', job: 'J', avatar: 'ada.png' })).toThrow();
  });
});

describe('UpdateBotPreset', () => {
  it('accepts every field partially, including an empty update', () => {
    expect(UpdateBotPreset.parse({})).toEqual({});
    expect(UpdateBotPreset.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(UpdateBotPreset.parse({ instructions: '' })).toEqual({ instructions: '' });
    expect(UpdateBotPreset.parse({ avatar: 'boto:black' })).toEqual({ avatar: 'boto:black' });
    expect(() => UpdateBotPreset.parse({ name: '' })).toThrow();
    expect(() => UpdateBotPreset.parse({ job: 'x'.repeat(121) })).toThrow();
  });
});

describe('CreatePresetFromBot', () => {
  it('takes an optional name override', () => {
    expect(CreatePresetFromBot.parse({})).toEqual({});
    expect(CreatePresetFromBot.parse({ name: 'Ada clone' })).toEqual({ name: 'Ada clone' });
    expect(() => CreatePresetFromBot.parse({ name: '' })).toThrow();
    expect(() => CreatePresetFromBot.parse({ name: 'x'.repeat(121) })).toThrow();
  });
});
