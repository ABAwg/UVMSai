const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(source, jsx = false) {
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  }).outputText;
  const result = {};
  vm.runInNewContext(compiled, { exports: result, require });
  return result;
}

const { inlineTokenPattern, readMathBlock, splitTableRow, tableColumnCount } = load('lib/markdown.ts');
const MathText = load('app/math.tsx', true).default;

test('Markdown table parser respects escaped pipes and inline code', () => {
  assert.equal(tableColumnCount('| Name | Value |', '| :--- | ---: |'), 2);
  assert.equal(tableColumnCount('| Name | Value |', '| --- |'), 0);
  assert.deepEqual(Array.from(splitTableRow('| `a|b` | c\\|d |')), ['`a|b`', 'c|d']);
});

test('recognizes inline and display LaTeX delimiters from model responses', () => {
  const inline = Array.from('Force \\(F=ma\\) and $a=F/m$'.matchAll(inlineTokenPattern()), match => match[0]);
  assert.deepEqual(inline, ['\\(F=ma\\)', '$a=F/m$']);
  assert.equal(readMathBlock(['\\[E=mc^2\\]'], 0).source, 'E=mc^2');
  assert.equal(readMathBlock(['\\[', '\\frac{1}{2}', '\\]'], 0).source, '\\frac{1}{2}');
  assert.equal(readMathBlock(['$$', 'x^2+y^2', '$$'], 0).source, 'x^2+y^2');
  assert.equal(readMathBlock(['\\[', 'x^2'], 0), null);
});

test('KaTeX renders fractions and escapes invalid or untrusted source', () => {
  const formula = renderToStaticMarkup(React.createElement(MathText, { source: '\\frac{1}{2}', displayMode: true }));
  assert.match(formula, /class="katex"/);
  assert.match(formula, /math-display/);
  const invalid = renderToStaticMarkup(React.createElement(MathText, { source: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(invalid, /<img/);
  assert.match(invalid, /&lt;img/);
  const link = renderToStaticMarkup(React.createElement(MathText, { source: '\\href{javascript:alert(1)}{click}' }));
  assert.doesNotMatch(link, /href="javascript:/);
  const fallback = renderToStaticMarkup(React.createElement(MathText, { source: '\\unknowncommand', fallbackSource: '\\(\\unknowncommand\\)' }));
  assert.match(fallback, /\\\(\\unknowncommand\\\)/);
});
