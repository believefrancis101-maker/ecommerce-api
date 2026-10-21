import { useEffect, useRef, useState } from 'react';
import './App.css';
import {
  API_BASE_URL,
  CONFIG_PROBLEM,
  PAGE_SIZE,
  fetchCategories,
  fetchProducts,
  parseMaxPriceToMinor,
} from './api';
import type {
  ApiFailure,
  Category,
  CursorPaginationMeta,
  Product,
  SortDirection,
  SortField,
} from './types';
import FilterBar from './components/FilterBar';
import ProductGrid from './components/ProductGrid';
import ResultsBar from './components/ResultsBar';

export default function App() {
  // Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<CursorPaginationMeta | null>(null);
  const [loading, setLoading] = useState<boolean>(CONFIG_PROBLEM === null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [retryToken, setRetryToken] = useState<number>(0);

  // Filters
  const [category, setCategory] = useState<string>('');
  const [sort, setSort] = useState<SortField>('name');
  const [order, setOrder] = useState<SortDirection>('asc');
  const [maxPriceInput, setMaxPriceInput] = useState<string>('');
  const [maxPriceMinor, setMaxPriceMinor] = useState<number | null>(null);

  // Cursor pagination: the current cursor plus a client-side stack of the
  // cursors of the pages already visited, so "Previous" can walk back.
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  // Last price actually sent to the API, so the debounced input below only
  // triggers a request once per distinct value.
  const appliedMaxPrice = useRef<number | null>(null);

  // 1. Load the categories once. A failure here is not fatal: the product list
  // still works, the filter simply stays on "All Categories".
  useEffect(() => {
    if (CONFIG_PROBLEM !== null) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      const outcome = await fetchCategories(API_BASE_URL, controller.signal);

      if (outcome.status === 'success') {
        setCategories(outcome.response.data ?? []);
      }
    })();

    return () => controller.abort();
  }, []);

  // 2. Load the products whenever the cursor, a filter or the retry token
  // changes. The effect cleanup aborts the previous request, so a fast change
  // of controls can never render a stale response.
  useEffect(() => {
    if (CONFIG_PROBLEM !== null) {
      return;
    }

    const controller = new AbortController();
    let aborted = false;

    void (async () => {
      setLoading(true);
      setFailure(null);

      try {
        const outcome = await fetchProducts(
          API_BASE_URL,
          { cursor, category, sort, order, maxPriceMinor },
          controller.signal,
        );

        if (outcome.status === 'aborted') {
          return;
        }

        if (outcome.status === 'failure') {
          setFailure(outcome.failure);
          return;
        }

        setProducts(outcome.response.data.products);
        setMeta(outcome.response.data.meta);
      } finally {
        // A superseded request must not clear the loading state of the request
        // that replaced it.
        if (!aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [cursor, category, sort, order, maxPriceMinor, retryToken]);

  // 3. Debounce the price input: the API is rate limited, so a request is only
  // sent once the user stops typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = parseMaxPriceToMinor(maxPriceInput);

      if (parsed === appliedMaxPrice.current) {
        return;
      }

      appliedMaxPrice.current = parsed;
      setMaxPriceMinor(parsed);
      setCursorStack((stack) => (stack.length === 0 ? stack : []));
      setCursor(null);
    }, 300);

    return () => clearTimeout(timer);
  }, [maxPriceInput]);

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    setCursorStack((stack) => (stack.length === 0 ? stack : []));
    setCursor(null);
  };

  const handleSortChange = (value: SortField) => {
    setSort(value);
    setCursorStack((stack) => (stack.length === 0 ? stack : []));
    setCursor(null);
  };

  const handleOrderChange = (value: SortDirection) => {
    setOrder(value);
    setCursorStack((stack) => (stack.length === 0 ? stack : []));
    setCursor(null);
  };

  const handleMaxPriceChange = (value: string) => {
    setMaxPriceInput(value);
  };

  const handleNextPage = () => {
    if (!meta?.hasMore || !meta.nextCursor) {
      return;
    }

    setCursorStack((stack) => [...stack, cursor ?? '']);
    setCursor(meta.nextCursor);
  };

  const handlePreviousPage = () => {
    if (cursorStack.length === 0) {
      return;
    }

    const previousCursor = cursorStack[cursorStack.length - 1];
    setCursorStack((stack) => stack.slice(0, -1));
    setCursor(previousCursor === '' ? null : previousCursor);
  };

  const handleRetry = () => {
    setRetryToken((token) => token + 1);
  };

  // The configuration error is rendered instead of the page, and no request is
  // ever made while it is in effect.
  if (CONFIG_PROBLEM !== null) {
    return (
      <main>
        <h1>Configuration Error</h1>
        <p>{CONFIG_PROBLEM}</p>
        <p>
          Set <code>VITE_API_URL</code> in <code>consumer/.env.local</code> to the live API URL,
          then restart the dev server.
        </p>
      </main>
    );
  }

  const pageIndex = cursorStack.length;
  const total = meta?.total ?? 0;
  const first = products.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const last = products.length === 0 ? 0 : first + products.length - 1;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand-section">
          <div>
            <h1 className="brand-title">ShopSphere Catalog</h1>
            <p className="brand-subtitle">
              Live external consumer reading directly from the Railway production API
            </p>
          </div>
          <div className="api-badge">
            <span className="api-dot" />
            <span>Live API: {new URL(API_BASE_URL).host}</span>
          </div>
        </div>
      </header>

      <FilterBar
        categories={categories}
        category={category}
        sort={sort}
        order={order}
        maxPriceInput={maxPriceInput}
        disabled={loading}
        onCategoryChange={handleCategoryChange}
        onSortChange={handleSortChange}
        onOrderChange={handleOrderChange}
        onMaxPriceChange={handleMaxPriceChange}
      />

      <ResultsBar
        first={first}
        last={last}
        total={total}
        canGoBack={cursorStack.length > 0}
        canGoForward={Boolean(meta?.hasMore && meta.nextCursor)}
        disabled={loading}
        onPrevious={handlePreviousPage}
        onNext={handleNextPage}
      />

      {loading && <p>Loading products…</p>}

      {!loading && failure !== null && (
        <div role="alert">
          <p>{failure.message}</p>
          <button type="button" className="btn btn-primary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && failure === null && products.length === 0 && (
        <p>No products match the filters.</p>
      )}

      {!loading && products.length > 0 && <ProductGrid products={products} />}
    </div>
  );
}
