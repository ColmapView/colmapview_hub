import { ID_PATTERN } from '../shared/model';
import type { Wordlists } from './crypto';

/** A requested name: a word pair in any letter case, with an optional long-name suffix kept as typed. */
const LOOSE_ID = /^([A-Za-z]{6,28})((?:-L?[A-Za-z0-9_-]{16})?)$/;

/** Fingerprint input for a miss: the word pair in lowercase, so letter-case variants of one guess count once. */
export function missKey(id: string): string {
  const match = LOOSE_ID.exec(id);
  return match ? match[1].toLowerCase() + match[2] : id;
}

const titleCase = (word: string) => word[0].toUpperCase() + word.slice(1);
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
 * The record key to read for a requested name, and whether a hit redirects to the canonical name.
 * A name in another letter case resolves through the private word lists. Unused and invalid word
 * pairs both still read R2 and both miss, so neither the answer nor its timing reveals the lists.
 */
export async function lookupTarget(id: string, words: () => Promise<Wordlists>): Promise<{ key: string; redirect: boolean } | null> {
  if (ID_PATTERN.test(id)) return { key: id, redirect: false };
  const match = LOOSE_ID.exec(id);
  if (!match) return null;
  const { adjectives, nouns } = setsFor(await words());
  const pair = match[1].toLowerCase();
  for (let split = 3; split <= pair.length - 3; split++) {
    const [adjective, noun] = [pair.slice(0, split), pair.slice(split)];
    if (adjectives.has(adjective) && nouns.has(noun)) return { key: titleCase(adjective) + titleCase(noun) + match[2], redirect: true };
  }
  return { key: pair + match[2], redirect: false };
}
