interface ResultsBarProps {
  first: number;
  last: number;
  total: number;
  canGoBack: boolean;
  canGoForward: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Result counter plus the cursor pagination controls. */
export default function ResultsBar({
  first,
  last,
  total,
  canGoBack,
  canGoForward,
  disabled,
  onPrevious,
  onNext,
}: ResultsBarProps) {
  return (
    <div className="results-header">
      <div className="results-count">
        Showing <strong>{first}</strong> to <strong>{last}</strong> of <strong>{total}</strong>{' '}
        products
      </div>

      <div className="pagination-controls">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onPrevious}
          disabled={disabled || !canGoBack}
        >
          ← Previous
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          disabled={disabled || !canGoForward}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
