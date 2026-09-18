export interface MonthlyCost {
  month: string; // 'YYYY-MM'
  cost: number;
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
  const height = 200;
  const padX = 32;
  const padY = 20;
  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);

  const points = data.map((d, i) => {
    const x = data.length === 1 ? width / 2 : padX + (i / (data.length - 1)) * (width - padX * 2);
    const y = height - padY - (d.cost / maxCost) * (height - padY * 2);
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48" preserveAspectRatio="xMidYMid meet">
      <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="stroke-border" strokeWidth={1} />
      {points.length > 1 && (
        <polyline points={polyline} fill="none" className="stroke-accent" strokeWidth={2} />
      )}
      {points.map((p) => (
        <g key={p.month}>
          <circle cx={p.x} cy={p.y} r={4} className="fill-accent">
            <title>{formatMonthLabel(p.month)}: ${p.cost.toFixed(2)}</title>
          </circle>
          <text x={p.x} y={height - 4} textAnchor="middle" className="fill-current text-fg-muted" style={{ fontSize: 10 }}>
            {formatMonthLabel(p.month)}
          </text>
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-current text-fg-secondary" style={{ fontSize: 10 }}>
            ${p.cost.toFixed(2)}
          </text>
        </g>
      ))}
    </svg>
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
