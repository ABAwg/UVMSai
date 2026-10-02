const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const output = ts.transpileModule(fs.readFileSync('lib/highlight.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const result = {};
vm.runInNewContext(output, { exports: result, require });
const { highlightedCode } = result;

test('selectively highlights common languages without guessing unknown fences', () => {
  for (const language of ['python', 'py', 'javascript', 'jsx', 'typescript', 'tsx', 'json', 'bash', 'sql', 'css']) {
    assert.equal(typeof highlightedCode('const value = 42', language), 'string');
  }
  assert.equal(highlightedCode('<div>safe</div>', 'unknown'), null);
  assert.equal(highlightedCode('x'.repeat(20001), 'python'), null);
});

test('highlight output escapes model-authored HTML', () => {
  const markup = highlightedCode('</code><script>alert(1)</script>', 'javascript');
  assert.ok(markup);
  assert.doesNotMatch(markup, /<script>|<\/code>/);
  assert.match(markup, /&lt;|&#x3C;/);
});
