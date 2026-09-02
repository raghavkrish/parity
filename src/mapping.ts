import { readFile } from "node:fs/promises";
import { parseMappingCsv, type ParseCsvResult } from "./discover.js";
import type { MappingPair } from "./types.js";

export type ParseMappingResult =
  | { ok: true; pairs: MappingPair[] }
  | { ok: false; error: string };

export async function loadMapping(filePath: string): Promise<ParseMappingResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `mapping unreadable: ${message}` };
  }

  const parsed: ParseCsvResult = parseMappingCsv(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.replace("mapping CSV", "mapping file") };
  }
  return parsed;
}
