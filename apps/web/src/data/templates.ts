import type { TranslationKey } from '../i18n';

/** Where a bot acts, as the bot form offers it. `desktop` is a sandbox with a screen. */
export type ComputerChoice = 'none' | 'sandbox' | 'desktop' | 'host';

export interface RoleTemplate {
  id: string;
  name: string;
  avatar: string;
  title: TranslationKey;
  job: TranslationKey;
  instructions: TranslationKey;
  computer: ComputerChoice;
  egress: string[];
  teamBudgetUsd?: number;
}

/** Role templates from docs/PRODUCT.md (A3). Each one only prefills the form. */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    id: 'chief',
    name: 'Capy',
    avatar: 'capivara:black',
    title: 'template.chief.title',
    job: 'template.chief.job',
    instructions: 'template.chief.instructions',
    computer: 'sandbox',
    egress: [],
    teamBudgetUsd: 5,
  },
  {
    id: 'researcher',
    name: 'Tamu',
    avatar: 'tamandua:teal',
    title: 'template.researcher.title',
    job: 'template.researcher.job',
    instructions: 'template.researcher.instructions',
    computer: 'sandbox',
    egress: ['*.wikipedia.org', 'arxiv.org', 'duckduckgo.com'],
    teamBudgetUsd: 2,
  },
  {
    id: 'sales',
    name: 'Tuca',
    avatar: 'tucano:amber',
    title: 'template.sales.title',
    job: 'template.sales.job',
    instructions: 'template.sales.instructions',
    computer: 'none',
    egress: [],
  },
  {
    id: 'support',
    name: 'Mico',
    avatar: 'mico:brown',
    title: 'template.support.title',
    job: 'template.support.job',
    instructions: 'template.support.instructions',
    computer: 'none',
    egress: [],
  },
  {
    id: 'bugfixer',
    name: 'Onça',
    avatar: 'onca:orange',
    title: 'template.bugfixer.title',
    job: 'template.bugfixer.job',
    instructions: 'template.bugfixer.instructions',
    computer: 'sandbox',
    egress: ['github.com', 'registry.npmjs.org'],
    teamBudgetUsd: 3,
  },
  {
    id: 'operator',
    name: 'Boto',
    avatar: 'boto:blue',
    title: 'template.operator.title',
    job: 'template.operator.job',
    instructions: 'template.operator.instructions',
    computer: 'desktop',
    egress: ['duckduckgo.com'],
    teamBudgetUsd: 2,
  },
];
