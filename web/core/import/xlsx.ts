import { readZip, type ZipEntry } from "./zip.ts";

export interface Sheet {
  name: string;
  /** Rows of sparse cells keyed by column letters (A, B, …). */
  rows: Record<string, string>[];
}

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase() as "amp"] ?? "";
  });

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : null;
};

/** Concatenate all <t> text nodes (handles rich-text runs). */
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join("");

function readText(entries: Map<string, ZipEntry>, path: string): string | null {
  const e = entries.get(path.toLowerCase());
  return e ? Buffer.from(e.data()).toString("utf8") : null;
}

/** Parse every worksheet of an XLSX workbook into rows of column-letter → string. */
export function readXlsx(buf: Uint8Array): Sheet[] {
  const entries = new Map(readZip(buf).map((e) => [e.path.toLowerCase(), e]));
  const workbook = readText(entries, "xl/workbook.xml");
  if (!workbook) throw new Error("Nie można otworzyć pliku XLSX.");
  const rels = readText(entries, "xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const t = attr(m[0], "Target");
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const shared: string[] = [];
  const sst = readText(entries, "xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name") ?? "";
    const rid = attr(m[0], "r:id");
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? readText(entries, path) : null;
    if (!xml) continue;
    const rows: Record<string, string>[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: Record<string, string> = {};
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1]!, "r") ?? "";
        const col = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase();
        if (!col) continue;
        const type = attr(c[1]!, "t");
        const inner = c[2] ?? "";
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
        else if (type === "inlineStr") value = textOf(inner);
        else value = v !== undefined ? decode(v) : "";
        row[col] = value;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
