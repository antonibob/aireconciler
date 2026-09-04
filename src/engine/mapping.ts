import type { CardEntry } from "./types.js";

/**
 * last-4 → cardholder. The Talius convention: the last-4 column is not noise,
 * it ASSIGNS each transaction to a cardholder, which the statement does not.
 */
export const TALIUS_CARDS: CardEntry[] = [
  { last4: "0807", holder: "Cal" },
  { last4: "3474", holder: "Frank" },
  { last4: "9494", holder: "Greg" },
  { last4: "9583", holder: "Greg" },
  { last4: "7878", holder: "Frank" },
  { last4: "2169", holder: "Rares" },
];

export function cardToHolder(
  last4: string,
  cards: CardEntry[] = TALIUS_CARDS,
): string {
  return cards.find((c) => c.last4 === last4)?.holder ?? "Unknown";
}

/** Required for a memo line: Map.fromPairs style helper. */
export function indexCards(cards: CardEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cards) m.set(c.last4, c.holder);
  return m;
}