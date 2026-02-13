'use client';

import { useState } from 'react';

type StepEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; result: unknown };

export function RunDetail({ stepsJson }: { stepsJson: string | null }) {
  if (!stepsJson) return <p className="text-zinc-400">No step data available.</p>;

  let steps: StepEntry[];
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return <p className="text-zinc-400">Invalid step data.</p>;
  }

  if (steps.length === 0) return <p className="text-zinc-400">No steps recorded.</p>;

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
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-xs text-zinc-500 mb-2">Assistant</div>
      <div className="text-sm whitespace-pre-wrap">{content}</div>
    </div>
  );
}

function ToolCallStep({ name, args, result }: { name: string; args: Record<string, unknown>; result: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-zinc-900 border border-purple-900/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded">Tool</span>
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-zinc-500 ml-auto">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Arguments</div>
            <pre className="text-xs bg-zinc-950 rounded p-2 overflow-x-auto text-zinc-300">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Result</div>
            <pre className="text-xs bg-zinc-950 rounded p-2 overflow-x-auto text-zinc-300 max-h-64 overflow-y-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
