import '../states.css';

interface StatusPanelProps {
  variant: 'empty' | 'error';
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

/** The empty state and the error state share one layout; only the copy differs. */
export default function StatusPanel({
  variant,
  title,
  message,
  actionLabel,
  onAction,
}: StatusPanelProps) {
  const isError = variant === 'error';

  return (
    <div className={isError ? 'state-box error-box' : 'state-box'}>
      <div className="state-icon" aria-hidden="true">
        {isError ? '❌' : '🔍'}
      </div>
      <h3 className={isError ? 'state-title error-title' : 'state-title'}>{title}</h3>
      <p className="state-description">{message}</p>
      <button
        type="button"
        className={isError ? 'btn btn-primary' : 'btn btn-secondary'}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}
