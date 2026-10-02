import katex from 'katex';

export default function MathText({ source, displayMode = false, fallbackSource }: { source: string; displayMode?: boolean; fallbackSource?: string }) {
  const fallback = fallbackSource ?? (displayMode ? `$$${source}$$` : `$${source}$`);
  if (source.length > 4000) return <span className={displayMode ? 'math-fallback math-display' : 'math-fallback'}>{fallback}</span>;
  try {
    // KaTeX escapes ordinary text and disallows link/HTML commands without trust.
    const html = katex.renderToString(source, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' });
    return <span className={displayMode ? 'math-display' : 'math-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span className={displayMode ? 'math-fallback math-display' : 'math-fallback'}>{fallback}</span>;
  }
}
