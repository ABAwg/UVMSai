export type ChartType = 'line' | 'bar' | 'pie' | 'scatter';
export type ChartPoint = { label: string; value: number; x?: number; y?: number };
export type ChartSpec = {
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  data: ChartPoint[];
};

function label(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
}

/** Treat model-authored chart JSON as untrusted input and keep SVG work bounded. */
export function parseChart(source: string): ChartSpec | null {
  if (source.length > 12000) return null;
  try {
    const input: unknown = JSON.parse(source);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const chart = input as Record<string, unknown>;
    if (chart.type !== 'line' && chart.type !== 'bar' && chart.type !== 'pie' && chart.type !== 'scatter') return null;
    if (!Array.isArray(chart.data) || chart.data.length < 1 || chart.data.length > (chart.type === 'pie' ? 16 : 40)) return null;
    const title = chart.title === undefined ? 'Chart' : label(chart.title, 160);
    const xLabel = chart.x_label === undefined ? '' : label(chart.x_label, 60);
    const yLabel = chart.y_label === undefined ? '' : label(chart.y_label, 60);
    if (title === null || xLabel === null || yLabel === null) return null;
    const data: ChartPoint[] = [];
    for (const raw of chart.data) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const point = raw as Record<string, unknown>;
      const pointLabel = label(point.label, 80);
      if (!pointLabel) return null;
      if (chart.type === 'scatter') {
        if (!finite(point.x) || !finite(point.y)) return null;
        data.push({ label: pointLabel, x: point.x, y: point.y, value: point.y });
      } else {
        if (!finite(point.value) || (chart.type === 'pie' && point.value < 0)) return null;
        data.push({ label: pointLabel, value: point.value });
      }
    }
    if (chart.type === 'pie' && !data.some(point => point.value > 0)) return null;
    return { type: chart.type, title, xLabel, yLabel, data };
  } catch { return null; }
}
