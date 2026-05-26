import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

const TITLE_FONT = '"Noto Sans SC", system-ui, sans-serif';

export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className = '',
}: PageHeaderProps) {
  const hasActions = Boolean(actions);

  return (
    <header
      className={[
        'page-header mb-1 md:mb-2 shrink-0 pb-4 border-b border-[color:var(--glass-border-subtle)]',
        hasActions ? 'flex items-start justify-between gap-4' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={hasActions ? 'flex-1 min-w-0' : ''}>
        <h1
          className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-3 leading-tight"
          style={{ fontFamily: TITLE_FONT, color: 'var(--text-primary)' }}
        >
          {Icon ? (
            <Icon
              className="w-6 h-6 md:w-7 md:h-7 shrink-0"
              style={{ color: 'var(--accent-primary)' }}
              aria-hidden
            />
          ) : null}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle ? (
          <p
            className="text-sm mt-1.5 leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {hasActions ? (
        <div className="shrink-0 flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
