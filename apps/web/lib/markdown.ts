/** Split Markdown table cells without treating escaped pipes or pipes in code as columns. */
export function inlineTokenPattern(): RegExp {
  return /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|(?<!\$)\$[^$\n]+\$(?!\$)|\\\([^\n]*?\\\))/g;
}

export function splitTableRow(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let code = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '|') { cell += '|'; index++; }
    else if (character === '`') { code = !code; cell += character; }
    else if (character === '|' && !code) { cells.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

export function tableColumnCount(header: string, separator: string): number {
  if (!header.includes('|') || !separator.includes('|')) return 0;
  const columns = splitTableRow(header);
  const rules = splitTableRow(separator);
  return columns.length >= 2 && columns.length <= 12 && rules.length === columns.length && rules.every(rule => /^:?-{3,}:?$/.test(rule)) ? columns.length : 0;
}

export type MathBlock = { source: string; raw: string; end: number };

/** Read common display-math delimiters while leaving incomplete streams as source text. */
export function readMathBlock(lines: string[], start: number): MathBlock | null {
  const openingLine = lines[start]?.trim();
  const opening = openingLine?.startsWith('$$') ? '$$' : openingLine?.startsWith('\\[') ? '\\[' : null;
  if (!opening) return null;
  const closing = opening === '$$' ? '$$' : '\\]';
  const first = openingLine.slice(opening.length);
  const sameLineClose = first.lastIndexOf(closing);
  if (sameLineClose >= 0 && !first.slice(sameLineClose + closing.length).trim()) {
    const source = first.slice(0, sameLineClose).trim();
    return source ? { source, raw: lines[start], end: start } : null;
  }
  const parts = [first];
  for (let index = start + 1; index < lines.length && index <= start + 80; index++) {
    const line = lines[index];
    const close = line.lastIndexOf(closing);
    if (close >= 0 && !line.slice(close + closing.length).trim()) {
      parts.push(line.slice(0, close));
      const source = parts.join('\n').trim();
      return source ? { source, raw: lines.slice(start, index + 1).join('\n'), end: index } : null;
    }
    parts.push(line);
    if (parts.join('\n').length > 4000) return null;
  }
  return null;
}
