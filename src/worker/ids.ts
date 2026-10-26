import { ID_PATTERN } from '../shared/model';
import { canonicalName } from './crypto';
import type { Wordlists } from './crypto';

/** A requested name: a word pair in any letter case, with an optional long-name suffix kept as typed. */
const LOOSE_ID = /^([A-Za-z]{6,28})((?:-L?[A-Za-z0-9_-]{16})?)$/;

/** Fingerprint input for a miss: the word pair in lowercase, so letter-case variants of one guess count once. */
export function missKey(id: string): string {
  const match = LOOSE_ID.exec(id);
  return match ? match[1].toLowerCase() + match[2] : id;
}

const wordSets = new WeakMap<Wordlists, { adjectives: Set<string>; nouns: Set<string> }>();

function setsFor(words: Wordlists) {
  let sets = wordSets.get(words);
  if (!sets) {
    sets = { adjectives: new Set(words.adjectives), nouns: new Set(words.nouns) };
    wordSets.set(words, sets);
  }
  return sets;
}

/**
 * The one record key to read for a requested name, and whether a hit redirects to the canonical name.
 * - A name with the canonical shape is read as typed when its own split (the letters before its second
 *   capital, and the rest) is a valid adjective and noun, or when no split is valid.
 * - Otherwise a word pair in any letter case resolves to the canonical name of its first valid split, and
 *   a hit redirects there. A long-name suffix is kept as typed.
 * - Any other word pair with no valid split reads its lowercase form.
 * - When the word lists fail to load, a name with the canonical shape is read as typed, which depends only
 *   on the lists' health, never on the name; for any other name the error propagates.
 * Unused and invalid word pairs both still read the database and both miss, so neither the answer nor its timing
 * reveals the lists. A name that is not a word pair reads nothing.
 */
export async function lookupTarget(id: string, words: () => Promise<Wordlists>): Promise<{ key: string; redirect: boolean } | null> {
  const match = LOOSE_ID.exec(id);
  if (!match) return null;
  const asTyped = ID_PATTERN.test(id) ? { key: id, redirect: false } : null;
  let lists: Wordlists;
  try { lists = await words(); }
  catch (error) { if (asTyped) return asTyped; throw error; }
  const { adjectives, nouns } = setsFor(lists);
  const pair = match[1].toLowerCase();
  const valid = (split: number) => adjectives.has(pair.slice(0, split)) && nouns.has(pair.slice(split));
  if (asTyped && valid(match[1].slice(1).search(/[A-Z]/) + 1)) return asTyped;
  for (let split = 3; split <= pair.length - 3; split++) {
    if (valid(split)) return { key: canonicalName(pair.slice(0, split), pair.slice(split)) + match[2], redirect: true };
  }
  return asTyped ?? { key: pair + match[2], redirect: false };
}
