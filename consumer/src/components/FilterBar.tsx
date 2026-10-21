import type { Category, SortDirection, SortField } from '../types';

interface FilterBarProps {
  categories: Category[];
  category: string;
  sort: SortField;
  order: SortDirection;
  maxPriceInput: string;
  disabled: boolean;
  onCategoryChange: (value: string) => void;
  onSortChange: (value: SortField) => void;
  onOrderChange: (value: SortDirection) => void;
  onMaxPriceChange: (value: string) => void;
}

export default function FilterBar({
  categories,
  category,
  sort,
  order,
  maxPriceInput,
  disabled,
  onCategoryChange,
  onSortChange,
  onOrderChange,
  onMaxPriceChange,
}: FilterBarProps) {
  return (
    <section className="filter-bar" aria-label="Product filters">
      <div className="filter-group">
        <label htmlFor="category-select">Category</label>
        <select
          id="category-select"
          className="filter-select"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">All Categories</option>
          {categories.map((option) => (
            <option key={option.id} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="sort-select">Sort By</label>
        <select
          id="sort-select"
          className="filter-select"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortField)}
          disabled={disabled}
        >
          <option value="name">Name</option>
          <option value="price">Price</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="order-select">Order</label>
        <select
          id="order-select"
          className="filter-select"
          value={order}
          onChange={(event) => onOrderChange(event.target.value as SortDirection)}
          disabled={disabled}
        >
          <option value="asc">Ascending (Low to High / A-Z)</option>
          <option value="desc">Descending (High to Low / Z-A)</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="max-price-input">Max Price (NGN)</label>
        <input
          id="max-price-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 5000"
          className="filter-input"
          value={maxPriceInput}
          onChange={(event) => onMaxPriceChange(event.target.value)}
          disabled={disabled}
        />
      </div>
    </section>
  );
}
