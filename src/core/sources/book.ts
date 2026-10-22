import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BOOK_URL =
  'https://www.gutenberg.org/cache/epub/46644/pg46644.txt';
export const BOOK_CACHE = 'data/sources/gutenberg-46644.txt';
export const BOOK_MANIFEST = 'data/sources/manifest.json';

export interface BookSection {
  index: number;
  heading: string;
  text: string;
}

export interface FetchBookResult {
  text: string;
  sha256: string;
  cached: boolean;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function fetchBookText(
  options: { force?: boolean; cachePath?: string } = {},
): Promise<FetchBookResult> {
  const cachePath = options.cachePath ?? BOOK_CACHE;

  if (!options.force) {
    try {
      const text = await readFile(cachePath, 'utf8');
      return { text, sha256: sha256(text), cached: true };
    } catch {
      // Cache miss; fetch below.
    }
  }

  const response = await fetch(BOOK_URL);
  if (!response.ok) {
    throw new Error(`Gutenberg fetch failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, text, 'utf8');

  const manifestPath = path.join(path.dirname(cachePath), 'manifest.json');
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    manifest = {};
  }
  manifest['gutenberg-46644'] = {
    url: BOOK_URL,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { text, sha256: sha256(text), cached: false };
}

export function stripGutenberg(text: string): string {
  const start = text.match(/\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const end = text.match(/\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);

  const bodyStart = start?.index !== undefined ? start.index + start[0].length : 0;
  const bodyEnd =
    end?.index !== undefined && end.index > bodyStart ? end.index : text.length;

  return text.slice(bodyStart, bodyEnd).trim();
}

const SECTION_SEPARATOR = /\r?\n[ \t]*-{10,}[ \t]*\r?\n/g;

const SKIP_HEADINGS = /^(contents|note|transcriber|invention and discovery|murray and gibb|page|london|brooklyn|printed by)/i;
const AD_HEADING =
  /(nimmo|catalogue|cheap edition|popular works|one hundredth|completion of|hugh miller|the earth's crust|uniform with|just ready|price|cloth extra|gilt edges|\b\d+mo\b|\b8vo\b|\b4to\b)/i;

function isFrontMatter(heading: string, text: string): boolean {
  return SKIP_HEADINGS.test(heading) || /CONTENTS\./i.test(text.slice(0, 300));
}

function isAdvertisement(heading: string): boolean {
  return AD_HEADING.test(heading);
}

function cleanHeading(line: string): string {
  return line
    .replace(/_/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitBookSections(body: string): BookSection[] {
  const chunks = body.split(SECTION_SEPARATOR);
  const sections: BookSection[] = [];
  let started = false;

  for (const chunk of chunks) {
    const text = chunk.trim();
    if (text.length < 40) continue;

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const headingLine = lines.find(
      (line) =>
        line.length >= 3 &&
        line.length <= 120 &&
        !line.startsWith('[') &&
        !/^\d+$/.test(line),
    );
    if (!headingLine) continue;

    const heading = cleanHeading(headingLine);
    if (!heading || !/[\p{L}]/u.test(heading)) continue;

    if (!started) {
      if (isFrontMatter(heading, text)) continue;
      started = true;
    }

    if (isAdvertisement(heading)) break;

    sections.push({ index: sections.length, heading, text });
  }

  return sections;
}

export function parseBook(text: string): BookSection[] {
  return splitBookSections(stripGutenberg(text));
}
