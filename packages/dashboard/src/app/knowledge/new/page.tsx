import { KnowledgeForm } from '../[id]/knowledge-form';

export default function NewKnowledgePage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <a href="/knowledge" className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <h2 className="text-xl font-bold">New Knowledge</h2>
      </div>
      <KnowledgeForm />
    </div>
  );
}
