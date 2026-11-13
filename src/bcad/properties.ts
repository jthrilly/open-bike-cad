/**
 * Reader/writer for Java "Properties" XML documents, which is the on-disk
 * format of .bcad files:
 *
 *   <?xml version="1.0" encoding="UTF-8" standalone="no"?>
 *   <!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
 *   <properties>
 *   <comment>...</comment>
 *   <entry key="Head angle">74.5</entry>
 *   ...
 *   </properties>
 *
 * The parser is dependency-free (no DOMParser) so it runs in tests and in the
 * browser alike, and it keeps entry order so a file round-trips cleanly.
 */

export interface PropertiesDoc {
  comment: string | null;
  /** Insertion-ordered key/value map. Values are always raw strings. */
  entries: Map<string, string>;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent] ?? m;
  });
}

export function encodeXml(s: string, attr = false): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (attr) out = out.replace(/"/g, '&quot;');
  // Escape control characters other than tab/newline/CR, which XML 1.0 forbids.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => `&#${c.charCodeAt(0)};`);
  return out;
}

export class PropertiesParseError extends Error {}

export function parseProperties(xml: string): PropertiesDoc {
  // Strip BOM.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (!/<properties[\s>]/.test(xml)) {
    throw new PropertiesParseError('Not a .bcad / Java properties XML file (no <properties> element found).');
  }
  const entries = new Map<string, string>();
  let comment: string | null = null;

  const commentMatch = /<comment>([\s\S]*?)<\/comment>/.exec(xml);
  if (commentMatch) comment = decodeXml(commentMatch[1]);

  // <entry key="...">value</entry>  or  <entry key="..."/>
  const re = /<entry\s+key\s*=\s*("([^"]*)"|'([^']*)')\s*(\/>|>([\s\S]*?)<\/entry>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const rawKey = m[2] ?? m[3] ?? '';
    const key = decodeXml(rawKey);
    const value = m[4] === '/>' ? '' : decodeXml(stripCdata(m[5] ?? ''));
    entries.set(key, value);
  }
  return { comment, entries };
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function serializeProperties(doc: PropertiesDoc): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">',
    '<properties>',
  ];
  if (doc.comment != null) lines.push(`<comment>${encodeXml(doc.comment)}</comment>`);
  for (const [k, v] of doc.entries) {
    lines.push(`<entry key="${encodeXml(k, true)}">${encodeXml(v)}</entry>`);
  }
  lines.push('</properties>', '');
  return lines.join('\n');
}
