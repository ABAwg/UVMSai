const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const chartExports = {};
const code = ts.transpileModule(fs.readFileSync('lib/chart.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: chartExports });
const { parseChart } = chartExports;
const componentExports = {};
const componentCode = ts.transpileModule(fs.readFileSync('app/chart.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(componentCode, { exports: componentExports, require });
const ChartView = componentExports.default;

test('accepts bounded line, bar, pie and scatter chart data', () => {
  for (const type of ['line', 'bar', 'pie']) {
    const chart = parseChart(JSON.stringify({ type, title: 'Revenue', x_label: 'Month', y_label: 'USD', data: [{ label: 'Jan', value: 12 }, { label: 'Feb', value: 8 }] }));
    assert.equal(chart.type, type);
    assert.equal(chart.title, 'Revenue');
    assert.equal(chart.data.length, 2);
  }
  assert.equal(parseChart(JSON.stringify({ type: 'bar', data: [{ label: 'Loss', value: -4 }] })).data[0].value, -4);
  const scatter = parseChart(JSON.stringify({ type: 'scatter', data: [{ label: 'Sample A', x: -2, y: 3.5 }] }));
  assert.equal(scatter.data[0].x, -2);
  assert.equal(scatter.data[0].value, 3.5);
});

test('rejects malformed and unbounded model-authored chart specs', () => {
  const invalid = [
    '{"type":"bar","data":',
    JSON.stringify({ type: 'html', data: [{ label: 'A', value: 1 }] }),
    JSON.stringify({ type: 'bar', data: Array.from({ length: 41 }, (_, i) => ({ label: String(i), value: i })) }),
    JSON.stringify({ type: 'bar', data: [{ label: 'A', value: '12' }] }),
    JSON.stringify({ type: 'scatter', data: [{ label: 'A', x: 1, y: null }] }),
    JSON.stringify({ type: 'pie', data: [{ label: 'A', value: -1 }] }),
    JSON.stringify({ type: 'pie', data: [{ label: 'A', value: 0 }] }),
    JSON.stringify({ type: 'line', data: [{ label: 'A', value: 1e100 }] }),
    JSON.stringify({ type: 'line', data: [{ label: 'A'.repeat(81), value: 1 }] }),
    ' '.repeat(12001),
  ];
  for (const source of invalid) assert.equal(parseChart(source), null);
});

test('renders every chart as SVG with accessible source data and escaped model text', () => {
  for (const type of ['line', 'bar', 'pie', 'scatter']) {
    const point = type === 'scatter' ? { label: '<script>alert(1)</script>', x: -2, y: 3 } : { label: '<script>alert(1)</script>', value: 3 };
    const chart = parseChart(JSON.stringify({ type, title: '<svg onload=alert(1)>', data: [point] }));
    const markup = renderToStaticMarkup(React.createElement(ChartView, { chart }));
    assert.match(markup, /<svg/);
    assert.match(markup, /View chart data/);
    assert.match(markup, /<table/);
    assert.doesNotMatch(markup, /<script>|<svg onload=/);
    assert.match(markup, /&lt;script&gt;/);
  }
});
