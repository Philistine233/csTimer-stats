import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError, parseCsv, parseDate, parseTime } from "./parse";

describe("parseTime", () => {
  it("parses a normal m:ss.xx time", () => {
    expect(parseTime("1:44.71")).toEqual({ timeMs: 104710, penalty: "none" });
  });
  it("parses a seconds-only time", () => {
    expect(parseTime("39.69")).toEqual({ timeMs: 39690, penalty: "none" });
  });
  it("parses an h:mm:ss.xx time", () => {
    expect(parseTime("1:02:03.45")).toEqual({ timeMs: 3723450, penalty: "none" });
  });
  it("parses millisecond precision", () => {
    expect(parseTime("12.345")).toEqual({ timeMs: 12345, penalty: "none" });
  });
  it("parses +2 (time already includes the 2s)", () => {
    expect(parseTime("1:53.72+")).toEqual({ timeMs: 113720, penalty: "+2" });
  });
  it("parses DNF with m:ss.xx inside", () => {
    expect(parseTime("DNF(1:16.63)")).toEqual({ timeMs: 76630, penalty: "DNF" });
  });
  it("parses DNF with seconds only inside", () => {
    expect(parseTime("DNF(39.69)")).toEqual({ timeMs: 39690, penalty: "DNF" });
  });
  it("has no floating-point drift", () => {
    expect(parseTime("1:30.29").timeMs).toBe(90290);
  });
  it.each(["", "abc", "1:2:3:4.5", "DNF()", "1:xx.00", "+"])("rejects %j", (bad) => {
    expect(() => parseTime(bad)).toThrow(ParseError);
  });
});

describe("parseDate", () => {
  it("reads the date as local time", () => {
    const d = new Date(parseDate("2026-09-16 11:26:59"));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()])
      .toEqual([2026, 8, 16, 11, 26, 59]);
  });
  it.each(["2026-02-31 10:00:00", "2026/09/16 11:26:59", "yesterday"])("rejects %j", (bad) => {
    expect(() => parseDate(bad)).toThrow(ParseError);
  });
});

const HEADER = "No.;Time;Comment;Scramble;Date;P.1";

describe("parseCsv", () => {
  it("rejects a file with the wrong header", () => {
    expect(() => parseCsv("a,b,c\n1,2,3")).toThrow(ParseError);
  });

  it("skips bad rows and keeps good ones", () => {
    const csv = [
      HEADER,
      "1;1:00.00;;R U;2026-09-16 10:00:00;1:00.00",
      "2;oops;;R U;2026-09-16 10:01:00;1:00.00",
      "3;1:02.00;;R U;not a date;1:02.00",
      "",
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.solves).toHaveLength(1);
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4]);
  });

  it("warns when Time and P.1 disagree", () => {
    const csv = `${HEADER}\n1;1:05.00+;;R U;2026-09-16 10:00:00;1:00.00`;
    expect(parseCsv(csv).warnings).toHaveLength(1);
  });

  it("sorts solves by timestamp", () => {
    const csv = [
      HEADER,
      "1;1:00.00;;R;2026-09-16 10:05:00;1:00.00",
      "2;1:01.00;;R;2026-09-16 10:00:00;1:01.00",
    ].join("\n");
    expect(parseCsv(csv).solves.map((s) => s.index)).toEqual([2, 1]);
  });

  it("handles Windows line endings and a BOM", () => {
    const csv = `﻿${HEADER}\r\n1;1:00.00;;R;2026-09-16 10:00:00;1:00.00\r\n`;
    expect(parseCsv(csv).solves).toHaveLength(1);
  });

  it("parses the full 5x5 fixture", () => {
    const text = readFileSync("fixtures/csTimerExport_20261119_131346.csv", "utf8");
    const r = parseCsv(text);
    expect(r.solves).toHaveLength(1190);
    expect(r.skipped).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.solves.filter((s) => s.penalty === "+2")).toHaveLength(4);
    expect(r.solves.filter((s) => s.penalty === "DNF")).toHaveLength(3);

    const first = r.solves[0];
    expect(first.index).toBe(1);
    expect(first.timeMs).toBe(104710);
    expect(r.solves.find((s) => s.index === 69)).toMatchObject({ timeMs: 113720, penalty: "+2" });
  });
});