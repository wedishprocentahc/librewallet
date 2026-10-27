import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  path: string;
  isDirectory: boolean;
  data(): Uint8Array;
}

/** Minimal ZIP reader (stored + deflate) — enough for XTB exports and XLSX files. */
export function readZip(buf: Uint8Array): ZipEntry[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Nie można otworzyć pliku ZIP.");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("Uszkodzony katalog ZIP.");
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const localOffset = b.readUInt32LE(p + 42);
    const path = b.toString((flags & 0x800) !== 0 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({
      path,
      isDirectory: path.endsWith("/"),
      data() {
        if (b.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Uszkodzony nagłówek ZIP.");
        const start = localOffset + 30 + b.readUInt16LE(localOffset + 26) + b.readUInt16LE(localOffset + 28);
        const raw = b.subarray(start, start + compSize);
        if (method === 0) return new Uint8Array(raw);
        if (method === 8) return new Uint8Array(inflateRawSync(raw));
        throw new Error(`Nieobsługiwana metoda kompresji ZIP: ${method}`);
      },
    });
  }
  return entries;
}
