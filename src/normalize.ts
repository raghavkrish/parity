export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
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
