/**
 * CSV that opens correctly in Russian Excel: `;` separator, UTF-8 BOM,
 * CRLF lines. Cells starting with = + - @ are prefixed with ' so a
 * malicious title can't become a formula (CSV injection).
 */
const FORMULA_RE = /^[=+\-@\t\r]/;
const NEEDS_QUOTES_RE = /[";\r\n]/;

const cell = (value: string | number | null | undefined): string => {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_RE.test(s)) {
    s = `'${s}`;
  }
  return NEEDS_QUOTES_RE.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const toCsv = (
  header: string[],
  rows: (string | number | null | undefined)[][]
): string =>
  `﻿${[header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
