import type { ReactNode } from 'react';

interface PageIntroProps {
  title: string;
  description: string;
  meta?: string;
  actions?: ReactNode;
}

export default function PageIntro({ title, description, meta, actions }: PageIntroProps) {
  return (
    <section className="ds-page-intro">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="ds-page-intro-title">{title}</h2>
          {meta && <span className="ds-page-intro-meta">{meta}</span>}
        </div>
        <p className="ds-page-intro-description">{description}</p>
      </div>
      {actions && <div className="ds-page-intro-actions">{actions}</div>}
    </section>
  );
}
