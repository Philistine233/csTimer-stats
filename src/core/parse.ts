import Papa from "papaparse";

export type Penalty = "none" | "+2" | "DNF";    // WCA penalties: none, almost solved, did not solve

export interface Solve {
  index: number;
  timeMs: number;   // Final time in ms, +2 already included. For a DNF, the raw time before the DNF.
  penalty: Penalty;
  timestamp: number;
  scramble: string;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ParseResult {
  solves: Solve[];
  skipped: SkippedRow[];
  warnings: SkippedRow[];
}

export class ParseError extends Error {}

const EXPECTED_HEADER = ["No.", "Time", "Comment", "Scramble", "Date", "P.1"];

/** "1:53.72" | "39.69" | "1:02:03.45" -> ms. Returns null if it isn't a time. */
function clockToMs(text: string): number | null {
  const parts = text.split(":");
  if (parts.length > 3) return null;
  const seconds = parts.pop()!;
  if (!/^\d+(\.\d+)?$/.test(seconds)) return null;
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  let ms = Math.round(Number(seconds) * 1000);
  let multiplier = 60_000;  // minutes, then hours
  for (let i = parts.length - 1; i >= 0; i--) {
    ms += Number(parts[i]) * multiplier;
    multiplier *= 60;
  }
  return ms;
}

/** Parse one csTimer Time cell: "1:44.71", "1:53.72+", "DNF(1:16.63)". */
export function parseTime(text: string): { timeMs: number; penalty: Penalty } {
  const t = text.trim();

  const dnf = /^DNF\((.+)\)$/.exec(t);
  if (dnf) {
    const ms = clockToMs(dnf[1]);
    if (ms === null) throw new ParseError(`Bad DNF time: "${text}"`);
    return { timeMs: ms, penalty: "DNF" };
  }

  if (t.endsWith("+")) {
    const ms = clockToMs(t.slice(0, -1));
    if (ms === null) throw new ParseError(`Bad +2 time: "${text}"`);
    return { timeMs: ms, penalty: "+2" };
  }

  const ms = clockToMs(t);
  if (ms === null) throw new ParseError(`Bad time: "${text}"`);
  return { timeMs: ms, penalty: "none" };
}

/** "2026-09-16 11:26:59" -> Unix ms, interpreted as local time. */
export function parseDate(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new ParseError(`Bad date: "${text}"`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Catch impossible dates like 2026-02-31 (Date would silently roll over)
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new ParseError(`Bad date: "${text}"`);
  }
  return date.getTime();
}

/** Parse CSV. Throws ParseError if mismatches */
export function parseCsv(fileText: string): ParseResult {
  const text = fileText.replace(/^﻿/, "");  // strip BOM
  const result = Papa.parse<Record<string, string>>(text, {
    delimiter: ";",
    header: true,
    skipEmptyLines: true,
  });

  const fields = result.meta.fields ?? [];
  const headerOk =
    fields.length === EXPECTED_HEADER.length && EXPECTED_HEADER.every((name, i) => fields[i] === name);
  if (!headerOk) {
    throw new ParseError(
      `File format incorrect.`,
    );
  }

  const solves: Solve[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: SkippedRow[] = [];

  result.data.forEach((row, i) => {
    const line = i + 2; // +1 for header, +1 for 1-based
    try {
      const index = Number(row["No."]);
      if (!Number.isInteger(index)) throw new ParseError(`Bad solve number: "${row["No."]}"`);

      const { timeMs, penalty } = parseTime(row["Time"] ?? "");
      const timestamp = parseDate(row["Date"] ?? "");

      // Cross-check against P.1 (raw time before penalty)
      const raw = row["P.1"] ? clockToMs(row["P.1"].trim()) : null;
      if (raw !== null) {
        const expected = penalty === "+2" ? raw + 2000 : raw;
        if (expected !== timeMs) {
          warnings.push({ line, reason: `Time ${row["Time"]} doesn't match P.1 ${row["P.1"]}` });
        }
      }

      solves.push({ index, timeMs, penalty, timestamp, scramble: row["Scramble"] ?? "" });
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      skipped.push({ line, reason: e.message });
    }
  });

  solves.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  return { solves, skipped, warnings };
}