// The letter-dissolve a task label plays when it's checked off.
//
// The label is split into per-character spans so each one can fade on its own
// delay. Characters are grouped into *words* first: a bare run of inline-block
// characters would let the browser wrap mid-word, which re-flows the label the
// instant the animation starts. Each word is one nowrap box, so the line
// breaks land exactly where they did a frame earlier and only the letters move.
//
// Pure so the grouping and the timing can be unit-tested without a DOM.

import type { TaskSegment } from "./links";

// Each character's own fade
export const CHAR_MS = 300;
// Gap between neighbouring characters, before the cap below applies
export const STAGGER_MS = 16;
// The whole sweep never takes longer than this, however long the task is —
// a forty-word task would otherwise hold the row for two seconds.
export const MAX_STAGGER_MS = 300;

export interface DissolveChar {
  char: string;
  delayMs: number;
  // Set when the character came from a link run, so it keeps the link colour
  // on the way out.
  isLink: boolean;
}

/** One nowrap box: the word plus whatever whitespace trailed it. */
export type DissolveWord = DissolveChar[];

const isWhitespace = (char: string) => /\s/.test(char);

/**
 * Delay for the character at `index` of `total`, spread evenly across the
 * capped sweep. Short labels get a tight stagger, long ones compress into the
 * same window rather than running on.
 */
export function charDelayMs(index: number, total: number): number {
  if (total <= 1) return 0;
  const span = Math.min(STAGGER_MS * (total - 1), MAX_STAGGER_MS);
  return Math.round((index / (total - 1)) * span);
}

/** How long the whole dissolve runs, last character included. */
export function dissolveDurationMs(charCount: number): number {
  if (charCount <= 0) return 0;
  return charDelayMs(charCount - 1, charCount) + CHAR_MS;
}

/**
 * Flatten the label's segments into words of delayed characters.
 *
 * Iteration is by code point, so an emoji stays one character rather than
 * dissolving as two broken halves.
 */
export function buildDissolveWords(segments: TaskSegment[]): DissolveWord[] {
  const flat: { char: string; isLink: boolean }[] = [];
  for (const segment of segments) {
    for (const char of segment.value) {
      flat.push({ char, isLink: segment.type === "link" });
    }
  }

  const words: DissolveWord[] = [];
  let current: DissolveChar[] = [];
  // A word ends at the first non-space *after* its trailing spaces, not at the
  // first space — that's what keeps the space attached to the word before it.
  let sawTrailingSpace = false;
  let index = 0;

  for (const entry of flat) {
    const space = isWhitespace(entry.char);
    if (!space && sawTrailingSpace) {
      words.push(current);
      current = [];
      sawTrailingSpace = false;
    }
    current.push({ ...entry, delayMs: charDelayMs(index, flat.length) });
    if (space && current.length > 0) sawTrailingSpace = true;
    index++;
  }
  if (current.length > 0) words.push(current);

  return words;
}
