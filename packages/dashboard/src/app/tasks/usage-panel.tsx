export interface MonthlyCost {
  month: string; // 'YYYY-MM'
  totalCost: number;
  runCount: number;
  avgCost: number;
}

export interface ExpensiveTask {
  taskId: number;
  taskName: string;
  cost: number;
  runCount: number;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

interface LineChartPoint {
  month: string;
  value: number;
  runCount: number;
}

// A single line, on its own honest scale — deliberately not overlaying total cost and
// avg cost/run on one shared axis: their magnitudes differ by orders of magnitude, so a
// shared/independently-normalized scale makes a line's height misrepresent its value
// relative to the other line (a viewer naturally reads "higher on the chart" as "bigger").
function SingleLineChart({ data, strokeClass, fillClass, format, dashed }: { data: LineChartPoint[]; strokeClass: string; fillClass: string; format: (v: number) => string; dashed?: boolean }) {
  if (data.length === 0) return <p className="text-fg-muted text-sm">No usage yet.</p>;

  const width = 640;
  const height = 180;
  const padX = 32;
  const padTop = 24;
  const padBottom = 44; // room for a 2-line x-axis label (month + run count)
  const maxValue = Math.max(...data.map((d) => d.value), 0.001);
  const plotHeight = height - padTop - padBottom;

  const xFor = (i: number) => (data.length === 1 ? width / 2 : padX + (i / (data.length - 1)) * (width - padX * 2));
  const points = data.map((d, i) => ({ x: xFor(i), y: height - padBottom - (d.value / maxValue) * plotHeight, ...d }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44" preserveAspectRatio="xMidYMid meet">
      <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} className="stroke-border" strokeWidth={1} />

      {points.length > 1 && (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          className={strokeClass}
          strokeWidth={2}
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      )}

      {points.map((p) => (
        <g key={p.month}>
          <circle cx={p.x} cy={p.y} r={4} className={fillClass} />
          <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-current text-fg-secondary" style={{ fontSize: 10 }}>
            {format(p.value)}
          </text>
          <text x={p.x} y={height - padBottom + 16} textAnchor="middle" className="fill-current text-fg-muted" style={{ fontSize: 10 }}>
            {formatMonthLabel(p.month)}
          </text>
          <text x={p.x} y={height - padBottom + 28} textAnchor="middle" className="fill-current text-fg-muted" style={{ fontSize: 9 }}>
            {p.runCount} run{p.runCount === 1 ? '' : 's'}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function UsagePanel({ monthlyCost, expensiveTasks }: { monthlyCost: MonthlyCost[]; expensiveTasks: ExpensiveTask[] }) {
  const totalData: LineChartPoint[] = monthlyCost.map((d) => ({ month: d.month, value: d.totalCost, runCount: d.runCount }));
  const avgData: LineChartPoint[] = monthlyCost.map((d) => ({ month: d.month, value: d.avgCost, runCount: d.runCount }));

  return (
    <div className="space-y-6">
      <div className="card-raised rounded-lg p-4">
        <h3 className="text-sm font-bold text-fg-muted uppercase tracking-wider mb-4">Total cost / month</h3>
        <SingleLineChart data={totalData} strokeClass="stroke-accent" fillClass="fill-accent" format={(v) => `$${v.toFixed(2)}`} />
      </div>

      <div className="card-raised rounded-lg p-4">
        <h3 className="text-sm font-bold text-fg-muted uppercase tracking-wider mb-4">Avg cost / run</h3>
        <SingleLineChart data={avgData} strokeClass="stroke-warning" fillClass="fill-warning" format={(v) => `$${v.toFixed(2)}`} dashed />
      </div>

      <div className="card-raised rounded-lg overflow-hidden">
        <h3 className="text-sm font-bold text-fg-muted uppercase tracking-wider px-4 pt-4 pb-2">Most expensive tasks this month</h3>
        {expensiveTasks.length === 0 ? (
          <p className="text-fg-muted text-sm px-4 pb-4">No runs this month yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted text-xs uppercase tracking-wider">
                <th className="py-2 px-4">Task</th>
                <th className="py-2 px-4">Runs</th>
                <th className="py-2 px-4">Cost</th>
              </tr>
            </thead>
            <tbody>
              {expensiveTasks.map((t) => (
                <tr key={t.taskId} className="border-b border-border-subtle last:border-0">
                  <td className="py-2 px-4 font-bold text-accent">{t.taskName}</td>
                  <td className="py-2 px-4 text-fg-muted">{t.runCount}</td>
                  <td className="py-2 px-4 text-fg-secondary">${t.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
