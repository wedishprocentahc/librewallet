/** Test helper: builds a ZIP with stored (uncompressed) entries. */
export function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, eocd]));
}

/** Builds a minimal one-sheet XLSX (shared strings for text cells, numbers raw). */
export function makeXlsx(sheetName: string, rows: (string | number)[][]): Uint8Array {
  const strings: string[] = [];
  const cell = (v: string | number, col: number, row: number) => {
    const ref = `${String.fromCharCode(65 + col)}${row + 1}`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    let i = strings.indexOf(v);
    if (i < 0) { strings.push(v); i = strings.length - 1; }
    return `<c r="${ref}" t="s"><v>${i}</v></c>`;
  };
  const sheet = `<worksheet><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ci, ri)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return makeZip({
    "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": sheet,
  });
}
