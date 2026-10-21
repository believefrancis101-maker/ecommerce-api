import { formatNaira } from '../api';
import type { Product } from '../types';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  return (
    <article className="product-card">
      <span className="card-category">{product.category.name}</span>
      <h2 className="card-title">{product.name}</h2>
      <p className="card-desc">{product.description}</p>
      <div className="card-footer">
        <span className="card-price">{formatNaira(product.priceMinor)}</span>
        <span className={`stock-badge ${product.stock === 0 ? 'out-of-stock' : ''}`}>
          {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
        </span>
      </div>
    </article>
  );
}
