import type { Case } from '../types';
import { A1 } from './A1';
import { A10 } from './A10';
import { A11 } from './A11';
import { A12 } from './A12';
import { A13 } from './A13';
import { A14 } from './A14';
import { A15 } from './A15';
import { A2 } from './A2';
import { A3 } from './A3';
import { A4 } from './A4';
import { A5 } from './A5';
import { A6 } from './A6';
import { A7 } from './A7';
import { A8 } from './A8';
import { A9 } from './A9';
import { B1 } from './B1';
import { B2 } from './B2';
import { B3 } from './B3';
import { B4 } from './B4';
import { B5 } from './B5';
import { B6 } from './B6';
import { B7 } from './B7';
import { B8 } from './B8';
import { C1 } from './C1';
import { C10 } from './C10';
import { C2 } from './C2';
import { C3 } from './C3';
import { C4 } from './C4';
import { C5 } from './C5';
import { C6 } from './C6';
import { C7 } from './C7';
import { C8 } from './C8';
import { C9 } from './C9';

/** Every case in docs/USE-CASES.md, in the document's order. */
export const ALL_CASES: readonly Case[] = [
  A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15,
  B1, B2, B3, B4, B5, B6, B7, B8,
  C1, C2, C3, C4, C5, C6, C7, C8, C9, C10,
];

/** The cases to run, in the order given. Unknown ids are an error, not a silent skip. */
export function selectCases(ids: readonly string[] | undefined, all: readonly Case[] = ALL_CASES): Case[] {
  if (ids === undefined) return [...all];
  const known = new Map(all.map((caseDef) => [caseDef.id, caseDef]));
  const wanted = ids.map((id) => id.trim().toUpperCase());
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`unknown case id(s): ${unknown.join(', ')}. Known: ${[...known.keys()].join(', ')}`);
  }
  return wanted.map((id) => known.get(id) as Case);
}
