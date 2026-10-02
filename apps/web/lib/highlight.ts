import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);

const LANGUAGES: Record<string, string> = {
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  css: 'css',
  js: 'javascript', jsx: 'javascript', javascript: 'javascript',
  json: 'json',
  py: 'python', python: 'python',
  sql: 'sql',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
};

/** Highlight only complete, bounded, explicitly supported code fences. */
export function highlightedCode(code: string, rawLanguage: string): string | null {
  const language = LANGUAGES[rawLanguage.trim().toLowerCase()];
  if (!language || code.length > 20_000 || code.split('\n').length > 400) return null;
  try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; }
  catch { return null; }
}
