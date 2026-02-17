import Link from 'next/link';

export function PageHeader({
  title,
  backHref,
}: {
  title: string;
  backHref?: string;
}) {
  if (backHref) {
    return (
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 mb-4 text-fg-muted hover:text-fg transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="text-xl font-bold text-fg">{title}</span>
      </Link>
    );
  }

  return <h2 className="text-2xl font-bold mb-4">{title}</h2>;
}
