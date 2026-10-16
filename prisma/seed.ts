import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Fixed seed value => every run generates byte-for-byte the same data.
// Products/orders have no natural unique key, so repeatability lives here.
const FIXED_SEED = 42;
const CATEGORY_COUNT = 20;
const PRODUCT_COUNT = 400;
const CUSTOMER_COUNT = 300;
const ORDER_COUNT = 500;
const BATCH_SIZE = 100;

// Fixed date window instead of faker.date.recent(): timestamps must never
// depend on when the script runs, because this script will also run in prod.
const ORDER_DATE_FROM = new Date('2026-01-01T00:00:00.000Z');
const ORDER_DATE_TO = new Date('2026-09-01T00:00:00.000Z');
const MAX_UPDATE_DELAY_HOURS = 72;

// Weighted to mirror a realistic order funnel: most orders end up paid,
// cancelled is the rarest. Weights are out of 100.
const ORDER_STATUSES = [
  { weight: 35, value: 'paid' },
  { weight: 30, value: 'pending' },
  { weight: 25, value: 'shipped' },
  { weight: 10, value: 'cancelled' },
] as const;

// Fixed list of 20 realistic store categories (no generated names).
const CATEGORY_NAMES = [
  'Electronics',
  'Phones & Tablets',
  'Computers & Accessories',
  "Men's Fashion",
  "Women's Fashion",
  'Shoes & Bags',
  'Home & Kitchen',
  'Furniture',
  'Appliances',
  'Beauty & Personal Care',
  'Health & Wellness',
  'Groceries',
  'Baby & Kids',
  'Toys & Games',
  'Sports & Outdoors',
  'Books & Stationery',
  'Automotive',
  'Pet Supplies',
  'Tools & Industrial',
  'Musical Instruments',
];

// Slug derived from the name only: lowercase, ampersands/apostrophes removed,
// everything else hyphenated. No row-number suffixes on categories.
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Not exported: this file is a script, not a module. Tests that need row
// counts query Prisma directly instead of importing from here.
async function getRowCounts() {
  const [categories, products, customers, orders, orderItems] = await Promise.all([
    prisma.category.count(),
    prisma.product.count(),
    prisma.customer.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
  ]);

  return { categories, products, customers, orders, orderItems };
}

// Insert in batches so we never send one huge statement (keeps Prisma and
// Postgres happy at a few hundred rows per table).
async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insert(rows.slice(i, i + BATCH_SIZE));
  }
}

// Not exported either: `npm run seed` is the only caller.
async function seed() {
  console.log(`[Seed] Deterministic seed (faker.seed(${FIXED_SEED}))`);
  faker.seed(FIXED_SEED);

  console.log('[Seed] Row counts BEFORE run:');
  console.table(await getRowCounts());

  // 1. Categories: 20 fixed names; ids generated in code like every other table.
  console.log(`[Seed] Inserting ${CATEGORY_COUNT} categories...`);
  const categories = CATEGORY_NAMES.slice(0, CATEGORY_COUNT).map((name) => ({
    id: faker.string.uuid(),
    name,
    slug: slugify(name),
  }));
  await insertInBatches(categories, (batch) =>
    prisma.category.createMany({ data: batch, skipDuplicates: true })
  );

  // 2. Customers: email embeds the row index, so uniqueness holds by
  //    construction (no dedupe needed, but skipDuplicates keeps re-runs safe).
  console.log(`[Seed] Inserting ${CUSTOMER_COUNT} customers...`);
  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return {
      id: faker.string.uuid(),
      name: `${firstName} ${lastName}`,
      email: `${clean(firstName)}.${clean(lastName)}.${i + 1}@example.com`,
    };
  });
  await insertInBatches(customers, (batch) =>
    prisma.customer.createMany({ data: batch, skipDuplicates: true })
  );

  // 3. Products: realistic Naira retail prices stored in kobo (minor units),
  //    e.g. NGN 1,500 = 150000 kobo. Distributed round-robin across categories
  //    so every category has stock.
  console.log(`[Seed] Inserting ${PRODUCT_COUNT} products...`);
  const products = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
    const category = categories[i % categories.length];
    const priceNaira = faker.number.int({ min: 1_500, max: 750_000 });
    return {
      id: faker.string.uuid(),
      categoryId: category.id,
      name: `${faker.commerce.productName()} ${i + 1}`,
      description: faker.commerce.productDescription(),
      priceMinor: priceNaira * 100,
      currency: 'NGN',
      stock: faker.number.int({ min: 5, max: 300 }),
    };
  });
  await insertInBatches(products, (batch) =>
    prisma.product.createMany({ data: batch, skipDuplicates: true })
  );

  // 4. Orders: statuses weighted (paid 35 / pending 30 / shipped 25 / cancelled 10),
  //    createdAt inside the fixed window, updatedAt = createdAt + 0..72h so it is
  //    deterministic and can never be earlier than createdAt.
  console.log(`[Seed] Inserting ${ORDER_COUNT} orders...`);
  const orders = Array.from({ length: ORDER_COUNT }, (_, i) => {
    const customer = customers[i % customers.length];
    const status = faker.helpers.weightedArrayElement(ORDER_STATUSES);
    const createdAt = faker.date.between({ from: ORDER_DATE_FROM, to: ORDER_DATE_TO });
    const updatedAt = new Date(
      createdAt.getTime() + faker.number.int({ min: 0, max: MAX_UPDATE_DELAY_HOURS }) * 3_600_000
    );
    return {
      id: faker.string.uuid(),
      customerId: customer.id,
      status,
      currency: 'NGN',
      createdAt,
      updatedAt,
    };
  });
  await insertInBatches(orders, (batch) =>
    prisma.order.createMany({ data: batch, skipDuplicates: true })
  );

  // 5. Order items: 1-5 distinct products per order; unitPriceMinor is copied
  //    from the product row so totals computed later always reconcile.
  console.log(`[Seed] Inserting order items (1 to 5 per order)...`);
  const orderItems: Array<{
    id: string;
    orderId: string;
    productId: string;
    quantity: number;
    unitPriceMinor: number;
  }> = [];

  for (const order of orders) {
    const itemCount = faker.number.int({ min: 1, max: 5 });
    const pickedProducts = faker.helpers.arrayElements(products, itemCount);
    for (const product of pickedProducts) {
      orderItems.push({
        id: faker.string.uuid(),
        orderId: order.id,
        productId: product.id,
        quantity: faker.number.int({ min: 1, max: 5 }),
        unitPriceMinor: product.priceMinor,
      });
    }
  }
  await insertInBatches(orderItems, (batch) =>
    prisma.orderItem.createMany({ data: batch, skipDuplicates: true })
  );

  // Before/after tables being identical is how we prove a re-run inserted 0 rows.
  console.log('[Seed] Row counts AFTER run:');
  console.table(await getRowCounts());
  console.log('[Seed] Done.');
}

seed()
  .catch((error) => {
    console.error('[Seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
