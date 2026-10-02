'use client';

import { useId } from 'react';
import type { ChartSpec } from '@/lib/chart';

const COLORS = ['#29d196', '#a5eb3d', '#56c8e7', '#f5ac68', '#d78df0', '#f2799b', '#83a6ff', '#e4cd6b'];
const WIDTH = 680;
const HEIGHT = 300;
const LEFT = 58;
const RIGHT = 20;
const TOP = 20;
const BOTTOM = 55;
const plotWidth = WIDTH - LEFT - RIGHT;
const plotHeight = HEIGHT - TOP - BOTTOM;

function number(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' }).format(value);
}

function range(values: number[], includeZero: boolean): [number, number] {
  const minimum = Math.min(...values, ...(includeZero ? [0] : []));
  const maximum = Math.max(...values, ...(includeZero ? [0] : []));
  if (minimum === maximum) return [minimum - 1, maximum + 1];
  return [minimum, maximum];
}

function shortLabel(value: string) { return value.length > 12 ? `${value.slice(0, 11)}…` : value; }

export default function ChartView({ chart }: { chart: ChartSpec }) {
  const titleId = useId();
  const isPie = chart.type === 'pie';
  const isScatter = chart.type === 'scatter';
  const values = chart.data.map(point => point.value);
  const [yMin, yMax] = range(values, !isScatter);
  const [xMin, xMax] = range(chart.data.map(point => point.x || 0), false);
  const xScale = (x: number) => LEFT + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = (y: number) => TOP + ((yMax - y) / (yMax - yMin)) * plotHeight;
  const xCategory = (index: number) => LEFT + ((index + .5) / chart.data.length) * plotWidth;
  const color = chart.type === 'scatter' ? COLORS[2] : COLORS[0];
  const total = values.reduce((sum, value) => sum + value, 0);
  const circumference = 2 * Math.PI * 83;
  let pieOffset = 0;

  return <figure className="chart-card" aria-labelledby={titleId}>
    <figcaption id={titleId}>{chart.title}<span>{chart.type} chart</span></figcaption>
    {isPie ? <div className="chart-pie-layout">
      <svg className="chart-pie" viewBox="0 0 240 240" role="img" aria-label={`${chart.title}, pie chart`}>
        {chart.data.map((point, index) => {
          const segment = point.value / total * circumference;
          const offset = pieOffset;
          pieOffset += segment;
          return segment > 0 && <circle key={index} cx="120" cy="120" r="83" fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="44" strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={-offset} transform="rotate(-90 120 120)"><title>{`${point.label}: ${number(point.value)} (${number(point.value / total * 100)}%)`}</title></circle>;
        })}
        <circle cx="120" cy="120" r="55" fill="var(--panel)" />
        <text x="120" y="116" textAnchor="middle" className="chart-pie-total">{number(total)}</text>
        <text x="120" y="137" textAnchor="middle" className="chart-pie-caption">total</text>
      </svg>
      <ul className="chart-legend">{chart.data.map((point, index) => <li key={index}><i style={{ backgroundColor: COLORS[index % COLORS.length] }}/><span title={point.label}>{point.label}</span><strong>{number(point.value / total * 100)}%</strong></li>)}</ul>
    </div> : <div className="chart-plot-scroll"><svg className="chart-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${chart.title}, ${chart.type} chart`}>
      {Array.from({ length: 5 }, (_, index) => {
        const value = yMin + (yMax - yMin) * (4 - index) / 4;
        const y = TOP + index * plotHeight / 4;
        return <g key={`grid-${index}`}><line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} className="chart-grid-line"/><text x={LEFT - 9} y={y + 4} textAnchor="end" className="chart-axis-text">{number(value)}</text></g>;
      })}
      {isScatter ? Array.from({ length: 5 }, (_, index) => <text key={`x-${index}`} x={LEFT + index * plotWidth / 4} y={HEIGHT - 29} textAnchor="middle" className="chart-axis-text">{number(xMin + index * (xMax - xMin) / 4)}</text>) : chart.data.map((point, index) => index % Math.ceil(chart.data.length / 8) === 0 || index === chart.data.length - 1 ? <text key={`x-${index}`} x={xCategory(index)} y={HEIGHT - 29} textAnchor="middle" className="chart-axis-text"><title>{point.label}</title>{shortLabel(point.label)}</text> : null)}
      {chart.type === 'bar' && chart.data.map((point, index) => {
        const x = xCategory(index);
        const y = yScale(point.value);
        const zero = yScale(0);
        const barWidth = Math.min(44, plotWidth / chart.data.length * .7);
        return <rect key={index} x={x - barWidth / 2} y={Math.min(y, zero)} width={barWidth} height={Math.max(1, Math.abs(y - zero))} rx="3" fill={point.value < 0 ? COLORS[5] : color}><title>{`${point.label}: ${number(point.value)}`}</title></rect>;
      })}
      {chart.type === 'line' && <>
        {chart.data.length > 1 && <polyline points={chart.data.map((point, index) => `${xCategory(index)},${yScale(point.value)}`).join(' ')} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
        {chart.data.map((point, index) => <circle key={index} cx={xCategory(index)} cy={yScale(point.value)} r="5" fill={color} stroke="var(--panel)" strokeWidth="2"><title>{`${point.label}: ${number(point.value)}`}</title></circle>)}
      </>}
      {isScatter && chart.data.map((point, index) => <circle key={index} cx={xScale(point.x!)} cy={yScale(point.y!)} r="6" fill={color} fillOpacity=".83" stroke="var(--panel)" strokeWidth="2"><title>{`${point.label}: (${number(point.x!)}, ${number(point.y!)})`}</title></circle>)}
      {chart.xLabel && <text x={LEFT + plotWidth / 2} y={HEIGHT - 4} textAnchor="middle" className="chart-axis-title">{chart.xLabel}</text>}
      {chart.yLabel && <text x="13" y={TOP + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 13 ${TOP + plotHeight / 2})`} className="chart-axis-title">{chart.yLabel}</text>}
    </svg></div>}
    <details className="chart-data"><summary>View chart data</summary><div><table><thead><tr><th>Label</th>{isScatter ? <><th>X</th><th>Y</th></> : <th>Value</th>}</tr></thead><tbody>{chart.data.map((point, index) => <tr key={index}><th scope="row">{point.label}</th>{isScatter ? <><td>{number(point.x!)}</td><td>{number(point.y!)}</td></> : <td>{number(point.value)}</td>}</tr>)}</tbody></table></div></details>
  </figure>;
}
