type Counters = Record<string, number>;
type Timings = Record<string, { count: number; totalMs: number }>;

const counters: Counters = {};
const timings: Timings = {};

export function incMetric(name: string, value = 1) {
  counters[name] = (counters[name] || 0) + value;
}

export function recordTiming(name: string, ms: number) {
  const cur = timings[name] || { count: 0, totalMs: 0 };
  cur.count += 1;
  cur.totalMs += ms;
  timings[name] = cur;
}

export function getMetricsSnapshot() {
  return {
    counters: { ...counters },
    timings: Object.fromEntries(
      Object.entries(timings).map(([k, v]) => [k, { ...v }])
    ),
  };
}

export function resetMetrics() {
  for (const k of Object.keys(counters)) delete counters[k];
  for (const k of Object.keys(timings)) delete timings[k];
}

