'use client';

import { useState } from 'react';

type StepEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; result: unknown };

export function RunSteps({ stepsJson }: { stepsJson: string | null }) {
  if (!stepsJson) return <p className="text-fg-muted">No step data available.</p>;

  let steps: StepEntry[];
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return <p className="text-fg-muted">Invalid step data.</p>;
  }

  if (steps.length === 0) return <p className="text-fg-muted">No steps recorded.</p>;

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i}>
          {step.type === 'text' ? (
            <TextStep content={step.content} />
          ) : (
            <ToolCallStep name={step.name} args={step.args} result={step.result} />
          )}
        </div>
      ))}
    </div>
  );
}

function TextStep({ content }: { content: string }) {
  return (
    <div className="card-raised rounded-lg p-4">
      <div className="text-xs text-fg-muted mb-2 uppercase tracking-wider">assistant</div>
      <div className="text-sm whitespace-pre-wrap">{content}</div>
    </div>
  );
}

function ToolCallStep({ name, args, result }: { name: string; args: Record<string, unknown>; result: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card-raised rounded-lg overflow-hidden border-l-2 border-l-accent">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
      >
        <span className="text-xs bg-accent/15 text-accent px-2 py-0.5 rounded font-medium">tool</span>
        <span className="text-sm font-bold">{name}</span>
        <span className="text-xs text-fg-muted ml-auto">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div>
            <div className="text-xs text-fg-muted mb-1 uppercase tracking-wider">args</div>
            <pre className="text-xs bg-inset rounded p-2 overflow-x-auto text-fg-secondary border border-border-subtle">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-fg-muted mb-1 uppercase tracking-wider">result</div>
            <pre className="text-xs bg-inset rounded p-2 overflow-x-auto text-fg-secondary max-h-64 overflow-y-auto border border-border-subtle">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
