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

function MonthlyCostChart({ data }: { data: MonthlyCost[] }) {
  if (data.length === 0) return <p className="text-fg-muted text-sm">No usage yet.</p>;

  const width = 640;
  const height = 220;
  const padX = 32;
  const padY = 24;
  const maxTotal = Math.max(...data.map((d) => d.totalCost), 0.01);
  const maxAvg = Math.max(...data.map((d) => d.avgCost), 0.01);

  const xFor = (i: number) => (data.length === 1 ? width / 2 : padX + (i / (data.length - 1)) * (width - padX * 2));

  const totalPoints = data.map((d, i) => ({ x: xFor(i), y: height - padY - (d.totalCost / maxTotal) * (height - padY * 2), ...d }));
  const avgPoints = data.map((d, i) => ({ x: xFor(i), y: height - padY - (d.avgCost / maxAvg) * (height - padY * 2), ...d }));

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" /> Total cost</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-warning" /> Avg cost / run</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52" preserveAspectRatio="xMidYMid meet">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="stroke-border" strokeWidth={1} />

        {totalPoints.length > 1 && (
          <polyline points={totalPoints.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-accent" strokeWidth={2} />
        )}
        {avgPoints.length > 1 && (
          <polyline points={avgPoints.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-warning" strokeWidth={2} strokeDasharray="4 3" />
        )}

        {totalPoints.map((p) => (
          <g key={`total-${p.month}`}>
            <circle cx={p.x} cy={p.y} r={4} className="fill-accent">
              <title>{formatMonthLabel(p.month)} total: ${p.totalCost.toFixed(2)} ({p.runCount} runs)</title>
            </circle>
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-current text-fg-secondary" style={{ fontSize: 10 }}>
              ${p.totalCost.toFixed(2)}
            </text>
          </g>
        ))}
        {avgPoints.map((p) => (
          <g key={`avg-${p.month}`}>
            <circle cx={p.x} cy={p.y} r={3.5} className="fill-warning">
              <title>{formatMonthLabel(p.month)} avg/run: ${p.avgCost.toFixed(3)}</title>
            </circle>
            <text x={p.x} y={p.y + 14} textAnchor="middle" className="fill-current text-warning" style={{ fontSize: 10 }}>
              ${p.avgCost.toFixed(2)}
            </text>
          </g>
        ))}
        {totalPoints.map((p) => (
          <text key={`label-${p.month}`} x={p.x} y={height - 6} textAnchor="middle" className="fill-current text-fg-muted" style={{ fontSize: 10 }}>
            {formatMonthLabel(p.month)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function UsagePanel({ monthlyCost, expensiveTasks }: { monthlyCost: MonthlyCost[]; expensiveTasks: ExpensiveTask[] }) {
  return (
    <div className="space-y-6">
      <div className="card-raised rounded-lg p-4">
        <h3 className="text-sm font-bold text-fg-muted uppercase tracking-wider mb-4">Monthly cost</h3>
        <MonthlyCostChart data={monthlyCost} />
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
