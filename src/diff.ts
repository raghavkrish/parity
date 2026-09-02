import { layoutBoxesEqual, summarizeLayoutBox } from "./layout.js";
import { compareText, consumeToMatch, flattenTexts, indexOfExact } from "./normalize.js";
import type { ContentModel, LayoutBox, LinkItem, Mismatch, TextBlock } from "./types.js";

function summarizeLink(text: string, href: string): string {
  return `${text} -> ${href}`;
}

function summarizeImage(alt: string, hash: string | null): string {
  return `alt=${JSON.stringify(alt)} hash=${hash ?? "null"}`;
}

function withWhere(
  mismatch: Mismatch,
  oldBlock?: TextBlock | LinkItem,
  newBlock?: TextBlock | LinkItem,
): Mismatch {
  return {
    ...mismatch,
    ...(oldBlock?.where ? { oldWhere: oldBlock.where } : {}),
    ...(newBlock?.where ? { newWhere: newBlock.where } : {}),
  };
}

export function diffModels(oldModel: ContentModel, newModel: ContentModel): Mismatch[] {
  const mismatches: Mismatch[] = [];

  if (flattenTexts(oldModel.texts) !== flattenTexts(newModel.texts)) {
    let i = 0;
    let j = 0;
    const oldTexts = oldModel.texts;
    const newTexts = newModel.texts;
    while (i < oldTexts.length && j < newTexts.length) {
      const oldValue = oldTexts[i].text;
      const newValue = newTexts[j].text;
      if (compareText(oldValue) === compareText(newValue)) {
        i += 1;
        j += 1;
        continue;
      }
      const newEnd = consumeToMatch(oldValue, newTexts, j);
      if (newEnd != null) {
        i += 1;
        j = newEnd;
        continue;
      }
      const oldEnd = consumeToMatch(newValue, oldTexts, i);
      if (oldEnd != null) {
        i = oldEnd;
        j += 1;
        continue;
      }
      const newHit = indexOfExact(oldValue, newTexts, j + 1);
      const oldHit = indexOfExact(newValue, oldTexts, i + 1);
      if (newHit != null && (oldHit == null || newHit - j <= oldHit - i)) {
        for (let k = j; k < newHit; k++) {
          mismatches.push(
            withWhere({ kind: "text_extra", index: k, newValue: newTexts[k].text }, undefined, newTexts[k]),
          );
        }
        j = newHit;
        continue;
      }
      if (oldHit != null) {
        for (let k = i; k < oldHit; k++) {
          mismatches.push(
            withWhere({ kind: "text_missing", index: k, oldValue: oldTexts[k].text }, oldTexts[k]),
          );
        }
        i = oldHit;
        continue;
      }
      mismatches.push(
        withWhere({ kind: "text_changed", index: i, oldValue, newValue }, oldTexts[i], newTexts[j]),
      );
      i += 1;
      j += 1;
    }
    for (; i < oldTexts.length; i++) {
      mismatches.push(
        withWhere({ kind: "text_missing", index: i, oldValue: oldTexts[i].text }, oldTexts[i]),
      );
    }
  }

  const linkN = Math.min(oldModel.links.length, newModel.links.length);
  for (let i = 0; i < linkN; i++) {
    const o = oldModel.links[i];
    const n = newModel.links[i];
    if (o.text !== n.text || o.href !== n.href) {
      mismatches.push(
        withWhere(
          {
            kind: "link_changed",
            index: i,
            oldValue: summarizeLink(o.text, o.href),
            newValue: summarizeLink(n.text, n.href),
          },
          o,
          n,
        ),
      );
    }
  }
  for (let i = linkN; i < oldModel.links.length; i++) {
    const o = oldModel.links[i];
    mismatches.push(
      withWhere({ kind: "link_missing", index: i, oldValue: summarizeLink(o.text, o.href) }, o),
    );
  }
  for (let i = linkN; i < newModel.links.length; i++) {
    const n = newModel.links[i];
    mismatches.push(
      withWhere({ kind: "link_extra", index: i, newValue: summarizeLink(n.text, n.href) }, undefined, n),
    );
  }

  const imageN = Math.min(oldModel.images.length, newModel.images.length);
  for (let i = imageN; i < oldModel.images.length; i++) {
    const o = oldModel.images[i];
    mismatches.push({
      kind: "image_missing",
      index: i,
      oldValue: summarizeImage(o.alt, o.hash),
    });
  }

  return mismatches;
}

export function diffLayouts(
  oldBoxes: LayoutBox[],
  newBoxes: LayoutBox[],
  epsilon?: number,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const n = Math.min(oldBoxes.length, newBoxes.length);

  for (let i = 0; i < n; i++) {
    const o = oldBoxes[i];
    const neu = newBoxes[i];
    if (!layoutBoxesEqual(o, neu, epsilon)) {
      mismatches.push({
        kind: "layout_changed",
        index: i,
        oldValue: summarizeLayoutBox(o),
        newValue: summarizeLayoutBox(neu),
      });
    }
  }
  for (let i = n; i < oldBoxes.length; i++) {
    mismatches.push({
      kind: "layout_missing",
      index: i,
      oldValue: summarizeLayoutBox(oldBoxes[i]),
    });
  }
  for (let i = n; i < newBoxes.length; i++) {
    mismatches.push({
      kind: "layout_extra",
      index: i,
      newValue: summarizeLayoutBox(newBoxes[i]),
    });
  }
  return mismatches;
}
