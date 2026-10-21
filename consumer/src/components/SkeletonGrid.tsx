import '../states.css';

/** Placeholder cards shown while a request is in flight. */
export default function SkeletonGrid() {
  return (
    <div className="products-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`skeleton-${index}`} className="skeleton-card" />
      ))}
    </div>
  );
}
