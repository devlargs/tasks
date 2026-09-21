// Link detection for task text (issue #66). Tasks are plain strings, so a URL
// typed into one has to be found after the fact. Kept pure and separate from
// the row component so the tricky parts — trailing punctuation, parentheses —
// can be unit-tested (see test/taskLinks.test.ts).

export type TaskSegment =
  { type: "text"; value: string } | { type: "link"; value: string; href: string };

// Matches an explicit http(s) URL or a bare www. host. Deliberately narrow:
// bare domains like "largs.dev" are left alone, because a task reading
// "renew hosting on largs.dev" shouldn't sprout a link mid-sentence.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;

// Punctuation that almost always belongs to the sentence, not the URL.
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", '"', ")", "]", "}", "»", "…"]);

const count = (text: string, char: string) => text.split(char).length - 1;

// "…see https://example.com/a_(b)." → "https://example.com/a_(b)"
// A closing bracket is kept when it balances an opening one inside the URL,
// which is what makes Wikipedia-style links survive.
function trimTrailingPunctuation(url: string): string {
  let out = url;
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (!TRAILING.has(last)) break;
    // Counted with the bracket still attached, so ">=" is the balanced case:
    // ".../Todo_(technique)" keeps its bracket, "(https://x.com)" doesn't.
    if (last === ")" && count(out, "(") >= count(out, ")")) break;
    if (last === "]" && count(out, "[") >= count(out, "]")) break;
    if (last === "}" && count(out, "{") >= count(out, "}")) break;
    out = out.slice(0, -1);
  }
  return out;
}

// The href handed to the shell. Bare www. hosts get a scheme so the main
// process's http(s)-only guard accepts them.
export function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// True when the match is a real target and not a bare scheme ("https://").
function hasHost(url: string): boolean {
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  return withoutScheme.length > 0 && withoutScheme !== "www." && withoutScheme.includes(".");
}

// Splits task text into alternating plain-text and link runs. Text always
// round-trips: joining every segment's `value` reproduces the input exactly,
// so nothing can be silently dropped from a task label.
export function parseTaskSegments(text: string): TaskSegment[] {
  const segments: TaskSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimTrailingPunctuation(match[0]);
    if (!url || !hasHost(url)) continue;

    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }
    segments.push({ type: "link", value: url, href: toHref(url) });
    cursor = start + url.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}

export function hasLink(text: string): boolean {
  return parseTaskSegments(text).some((segment) => segment.type === "link");
}
