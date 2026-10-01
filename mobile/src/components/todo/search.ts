// Filtering the day's list by what a task says. Pure, so the matching rules
// can be unit-tested (see test/taskSearch.test.ts).

// Case and accents don't count: "cafe" finds "Café"
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// The words of a query, folded. Empty when there's nothing to filter by.
export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

// A task matches when every word of the query appears somewhere in it, in any
// order — "notion invoice" finds "Send the invoice from Notion".
export function matchesSearch(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = fold(text);
  return terms.every((term) => haystack.includes(term));
}
