/** Number/date parsing shared by the importers (local-time dates, like the native app's formatters). */

export const nilIfEmpty = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

export function parseNumber(value: string | null | undefined): number | null {
  const s = (value ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replaceAll(" ", "").replaceAll(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** IBKR-style numbers: "1,234.56" (comma = thousands) vs "12,5" (comma = decimal). */
export function parseNumberIbkr(raw: string | null | undefined): number | null {
  let s = (raw ?? "").trim().replaceAll(" ", "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) s = s.replaceAll(",", "");
  else if (s.includes(",")) s = s.replaceAll(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function build(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  const date = new Date(y, mo - 1, d, h, mi, s);
  // reject overflow like 2024-13-45
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

const FORMATS: { re: RegExp; make: (m: RegExpExecArray) => Date | null }[] = [
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, make: (m) => build(+m[1]!, +m[2]!, +m[3]!) },
  { re: /^(\d{4})(\d{2})(\d{2})$/, make: (m) => build(+m[1]!, +m[2]!, +m[3]!) },
  { re: /^(\d{4})-(\d{2})-(\d{2})[ T,]\s*(\d{2}):(\d{2}):(\d{2})$/, make: (m) => build(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!) },
  { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, make: (m) => build(+m[3]!, +m[2]!, +m[1]!) },
  { re: /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/, make: (m) => build(+m[3]!, +m[2]!, +m[1]!, +m[4]!, +m[5]!, +m[6]!) },
];

/** Accepts yyyy-MM-dd and dd.MM.yyyy (the universal template formats). */
export function parseDateStrict(value: string | null | undefined): Date | null {
  const s = (value ?? "").trim();
  for (const f of [FORMATS[0]!, FORMATS[3]!]) {
    const m = f.re.exec(s);
    if (m) return f.make(m);
  }
  return null;
}

/** Wider set used for generic XTB CSV rows: ISO 8601, yyyy-MM-dd[ HH:mm:ss], dd.MM.yyyy[ HH:mm:ss], dd/MM/yyyy. */
export function parseDateLoose(value: string | null | undefined): Date | null {
  const s = (value ?? "").trim();
  if (s === "") return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  for (const f of FORMATS) {
    const m = f.re.exec(s);
    if (m) {
      const d = f.make(m);
      if (d) return d;
    }
  }
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return slash ? build(+slash[3]!, +slash[2]!, +slash[1]!) : null;
}

/** Excel 1900 date system: Unix epoch is 25569 days after 1899-12-30. */
export function excelSerialToDate(serial: number): Date {
  return new Date((serial - 25569) * 86400 * 1000);
}

export function parseExcelOrDate(value: string | null | undefined): Date | null {
  const s = (value ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  if (Number.isFinite(n)) return excelSerialToDate(n);
  return parseDateLoose(s);
}

/** IBKR date formats, incl. "dd/MM/yyyy" and "MM/dd/yyyy". */
export function parseDateIbkr(raw: string | null | undefined): Date | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const loose = parseDateLoose(s);
  if (loose) return loose;
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (slash) return build(+slash[3]!, +slash[1]!, +slash[2]!); // MM/dd/yyyy fallback
  return null;
}
