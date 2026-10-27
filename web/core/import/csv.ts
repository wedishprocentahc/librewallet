export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(";")) return ";";
  return ",";
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Decode as UTF-8, falling back to Windows-1250 (common for Polish broker exports). */
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(data);
  }
}

export function parseCsv(data: Uint8Array | string): Record<string, string>[] {
  const text = typeof data === "string" ? data : decodeText(data);
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0];
  if (headerLine === undefined) return [];
  const delimiter = detectDelimiter(headerLine);
  const headers = splitLine(headerLine, delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = splitLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { if (i < values.length) row[h] = values[i]!; });
    return row;
  });
}
