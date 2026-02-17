import { KnowledgeForm } from '../[id]/knowledge-form';
import { PageHeader } from '../../components/page-header';

export default function NewKnowledgePage() {
  return (
    <div>
      <PageHeader title="Knowledge" backHref="/knowledge" />
      <KnowledgeForm />
    </div>
  );
}
