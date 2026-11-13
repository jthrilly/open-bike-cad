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

export class PropertiesParseError extends Error {}

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new PropertiesParseError(`Invalid character reference ${m}`);
      return String.fromCodePoint(code);
    }
    return NAMED[ent] ?? m;
  });
}

export function encodeXml(s: string, attr = false): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // A raw CR would be turned into a newline by any XML reader, so write it as a reference.
  out = out.replace(/\r/g, '&#13;');
  // In attributes, readers turn raw tabs and newlines into spaces.
  if (attr) out = out.replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
  // Escape control characters other than tab/newline/CR, which XML 1.0 forbids.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => `&#${c.charCodeAt(0)};`);
  return out;
}

/** Read the attributes of a start tag such as `<entry key="a" foo='b'>`. */
function readAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s=/<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    // XML attribute-value normalisation: literal whitespace becomes a space; references are kept.
    attrs.set(m[1], decodeXml((m[2] ?? m[3] ?? '').replace(/[\t\n]/g, ' ')));
  }
  return attrs;
}

/**
 * Read element content up to the matching close tag, decoding entities in text
 * and taking CDATA sections literally. Returns the text and the index after the close tag.
 */
function readContent(xml: string, from: number, name: string): { text: string; end: number } {
  const close = `</${name}`;
  let text = '';
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) throw new PropertiesParseError(`Unclosed <${name}> element.`);
    text += decodeXml(xml.slice(i, lt));
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (e < 0) throw new PropertiesParseError('Unclosed CDATA section.');
      text += xml.slice(lt + 9, e);
      i = e + 3;
    } else if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e < 0 ? xml.length : e + 3;
    } else if (xml.startsWith(close, lt)) {
      const gt = xml.indexOf('>', lt);
      return { text, end: gt < 0 ? xml.length : gt + 1 };
    } else {
      throw new PropertiesParseError(`Unexpected markup inside <${name}>.`);
    }
  }
  throw new PropertiesParseError(`Unclosed <${name}> element.`);
}

/** Index of the '>' that ends the tag starting at `lt`, skipping quoted attribute values. */
function tagEnd(xml: string, lt: number): number {
  let quote = '';
  for (let j = lt + 1; j < xml.length; j++) {
    const c = xml[j];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j;
  }
  return -1;
}

export function parseProperties(xml: string): PropertiesDoc {
  // Strip BOM and normalise line endings the way every XML reader does.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  xml = xml.replace(/\r\n?/g, '\n');
  if (!/<properties[\s>]/.test(xml)) {
    throw new PropertiesParseError('Not a .bcad / Java properties XML file (no <properties> element found).');
  }
  const entries = new Map<string, string>();
  let comment: string | null = null;

  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e < 0 ? xml.length : e + 3;
    } else if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2);
      i = e < 0 ? xml.length : e + 2;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      i = e < 0 ? xml.length : e + 3;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [...].
      let j = lt + 2;
      let depth = 0;
      while (j < xml.length) {
        const c = xml[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
    } else {
      const gt = tagEnd(xml, lt);
      if (gt < 0) break;
      const tag = xml.slice(lt, gt + 1);
      const name = /^<\/?([^\s/>]+)/.exec(tag)?.[1] ?? '';
      const selfClosing = tag.endsWith('/>');
      i = gt + 1;
      if (tag[1] === '/') continue;
      if (name === 'entry') {
        const key = readAttrs(tag).get('key');
        let value = '';
        if (!selfClosing) {
          const c = readContent(xml, i, 'entry');
          value = c.text;
          i = c.end;
        }
        if (key != null) entries.set(key, value);
      } else if (name === 'comment') {
        if (selfClosing) comment = comment ?? '';
        else {
          const c = readContent(xml, i, 'comment');
          comment = comment ?? c.text;
          i = c.end;
        }
      }
    }
  }
  return { comment, entries };
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
