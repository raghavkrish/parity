import { layoutBoxesEqual, summarizeLayoutBox } from "./layout.js";
import { flattenTexts } from "./normalize.js";
import type { ContentModel, LayoutBox, Mismatch } from "./types.js";

function summarizeLink(text: string, href: string): string {
  return `${text} -> ${href}`;
}

function summarizeImage(alt: string, hash: string | null): string {
  return `alt=${JSON.stringify(alt)} hash=${hash ?? "null"}`;
}

export function diffModels(oldModel: ContentModel, newModel: ContentModel): Mismatch[] {
  const mismatches: Mismatch[] = [];

  if (flattenTexts(oldModel.texts) !== flattenTexts(newModel.texts)) {
    const textN = Math.min(oldModel.texts.length, newModel.texts.length);
    for (let i = 0; i < textN; i++) {
      if (oldModel.texts[i].text !== newModel.texts[i].text) {
        mismatches.push({
          kind: "text_changed",
          index: i,
          oldValue: oldModel.texts[i].text,
          newValue: newModel.texts[i].text,
        });
      }
    }
    for (let i = textN; i < oldModel.texts.length; i++) {
      mismatches.push({
        kind: "text_missing",
        index: i,
        oldValue: oldModel.texts[i].text,
      });
    }
    for (let i = textN; i < newModel.texts.length; i++) {
      mismatches.push({
        kind: "text_extra",
        index: i,
        newValue: newModel.texts[i].text,
      });
    }
  }

  const linkN = Math.min(oldModel.links.length, newModel.links.length);
  for (let i = 0; i < linkN; i++) {
    const o = oldModel.links[i];
    const n = newModel.links[i];
    if (o.text !== n.text || o.href !== n.href) {
      mismatches.push({
        kind: "link_changed",
        index: i,
        oldValue: summarizeLink(o.text, o.href),
        newValue: summarizeLink(n.text, n.href),
      });
    }
  }
  for (let i = linkN; i < oldModel.links.length; i++) {
    const o = oldModel.links[i];
    mismatches.push({
      kind: "link_missing",
      index: i,
      oldValue: summarizeLink(o.text, o.href),
    });
  }
  for (let i = linkN; i < newModel.links.length; i++) {
    const n = newModel.links[i];
    mismatches.push({
      kind: "link_extra",
      index: i,
      newValue: summarizeLink(n.text, n.href),
    });
  }

  const imageN = Math.min(oldModel.images.length, newModel.images.length);
  for (let i = 0; i < imageN; i++) {
    const o = oldModel.images[i];
    const n = newModel.images[i];
    if (o.hash === null || n.hash === null) {
      mismatches.push({
        kind: "image_error",
        index: i,
        oldValue: summarizeImage(o.alt, o.hash),
        newValue: summarizeImage(n.alt, n.hash),
        detail: o.error ?? n.error,
      });
      continue;
    }
    if (o.alt !== n.alt || o.hash !== n.hash) {
      mismatches.push({
        kind: "image_changed",
        index: i,
        oldValue: summarizeImage(o.alt, o.hash),
        newValue: summarizeImage(n.alt, n.hash),
      });
    }
  }
  for (let i = imageN; i < oldModel.images.length; i++) {
    const o = oldModel.images[i];
    mismatches.push({
      kind: "image_missing",
      index: i,
      oldValue: summarizeImage(o.alt, o.hash),
    });
  }
  for (let i = imageN; i < newModel.images.length; i++) {
    const n = newModel.images[i];
    mismatches.push({
      kind: "image_extra",
      index: i,
      newValue: summarizeImage(n.alt, n.hash),
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
