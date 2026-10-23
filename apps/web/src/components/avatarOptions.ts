import type { AvatarColor, AvatarSpecies } from '@brot/ui';
import type { TranslationKey } from '../i18n';

export const SPECIES_KEY: Record<AvatarSpecies, TranslationKey> = {
  capivara: 'species.capivara',
  onca: 'species.onca',
  tucano: 'species.tucano',
  arara: 'species.arara',
  tamandua: 'species.tamandua',
  boto: 'species.boto',
  preguica: 'species.preguica',
  mico: 'species.mico',
  lobo: 'species.lobo',
  jabuti: 'species.jabuti',
};

export const COLOR_KEY: Record<AvatarColor, TranslationKey> = {
  black: 'color.black',
  teal: 'color.teal',
  violet: 'color.violet',
  blue: 'color.blue',
  orange: 'color.orange',
  amber: 'color.amber',
  pink: 'color.pink',
  brown: 'color.brown',
  gray: 'color.gray',
  white: 'color.white',
};
