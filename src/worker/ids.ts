/** A requested name: a word pair in any letter case, with an optional long-name suffix kept as typed. */
const LOOSE_ID = /^([A-Za-z]{6,28})((?:-L?[A-Za-z0-9_-]{16})?)$/;

/** Fingerprint input for a miss: the word pair in lowercase, so letter-case variants of one guess count once. */
export function missKey(id: string): string {
  const match = LOOSE_ID.exec(id);
  return match ? match[1].toLowerCase() + match[2] : id;
}
