import { toSpecies, type AvatarShape, type AvatarSpecies } from '@brot/ui';

/** Each demo bot's animal, by name, so a bot's name and face always agree across locales. */
const BY_NAME: Record<string, AvatarSpecies> = {
  Capy: 'capivara',
  Onça: 'onca',
  Tuca: 'tucano',
  Jabu: 'jabuti',
  Iara: 'boto',
  Bento: 'preguica',
};

export function speciesOf(bot: { name: string; shape?: AvatarShape; species?: AvatarSpecies }): AvatarSpecies {
  return bot.species ?? BY_NAME[bot.name] ?? (bot.shape ? toSpecies(bot.shape) : undefined) ?? 'capivara';
}
