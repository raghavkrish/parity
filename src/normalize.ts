export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Compare form: drop the AED currency token, then collapse spaces. */
export function compareText(input: string): string {
  return normalizeText(input.replace(/\bAED\b/gi, " "));
}

/** Join per-tag text blocks so split/merged headings compare as the same copy. */
export function flattenTexts(texts: Array<{ text: string }>): string {
  return compareText(texts.map((t) => t.text).join(" "));
}

export const TEXT_MERGE_CAP = 8;

/**
 * If joining blocks[start..] equals target (each partial join a prefix),
 * return the index after the last consumed block. Otherwise null.
 */
export function consumeToMatch(
  target: string,
  blocks: Array<{ text: string }>,
  start: number,
  cap = TEXT_MERGE_CAP,
): number | null {
  const want = compareText(target);
  if (!want || start >= blocks.length) return null;
  let acc = "";
  const limit = Math.min(blocks.length, start + cap);
  for (let k = start; k < limit; k++) {
    acc = compareText(acc ? `${acc} ${blocks[k].text}` : blocks[k].text);
    if (acc === want) return k + 1;
    if (!want.startsWith(acc)) return null;
  }
  return null;
}

/** First exact text match in [start, start+cap). */
export function indexOfExact(
  target: string,
  blocks: Array<{ text: string }>,
  start: number,
  cap = TEXT_MERGE_CAP,
): number | null {
  const want = compareText(target);
  if (!want || start >= blocks.length) return null;
  const limit = Math.min(blocks.length, start + cap);
  for (let k = start; k < limit; k++) {
    if (compareText(blocks[k].text) === want) return k;
  }
  return null;
}

/** pathname + search only; origin and hash stripped */
export function normalizeHref(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
