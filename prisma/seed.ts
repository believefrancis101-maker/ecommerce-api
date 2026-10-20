// FROZEN once seeded into production: changing generation logic produces
// different ids and a second dataset next to the first.

import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Fixed seed value => every run generates byte-for-byte the same data.
// Products/orders have no natural unique key, so repeatability lives here.
const FIXED_SEED = 42;
const PRODUCT_COUNT = 400;
const CUSTOMER_COUNT = 300;
const ORDER_COUNT = 500;
const BATCH_SIZE = 100;

// Fixed date window instead of faker.date.recent(): timestamps must never
// depend on when the script runs, because this script will also run in prod.
const ORDER_DATE_FROM = new Date('2026-01-01T00:00:00.000Z');
const ORDER_DATE_TO = new Date('2026-09-01T00:00:00.000Z');
const MAX_UPDATE_DELAY_HOURS = 72;

// Categories/products/customers also get a FIXED createdAt (not now()): seeded
// fixtures must be byte-identical between a fresh seed and a migrated database,
// and the matching migration backfills pre-existing rows to this same value.
const SEEDED_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

// Weighted to mirror a realistic order funnel: most orders end up paid,
// cancelled is the rarest. Weights are out of 100.
const ORDER_STATUSES = [
  { weight: 35, value: 'paid' },
  { weight: 30, value: 'pending' },
  { weight: 25, value: 'shipped' },
  { weight: 10, value: 'cancelled' },
] as const;

// Fixed list of 20 realistic store categories (no generated names). This list
// is the single source of truth for how many categories exist — no separate
// count constant that could drift out of sync with it.
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

// Neutral name prefixes. A fixed list rather than faker.commerce.productAdjective():
// the vocabulary stays stable and on-brand, and the pick is still deterministic.
const PRODUCT_ADJECTIVES = ['Classic', 'Premium', 'Everyday', 'Essential', 'Deluxe', 'Standard', 'Select', 'Original'];

// Category-aware name suffixes. A category whose `variants` is empty gets no
// suffix at all.
const COLOUR_VARIANTS = ['Black', 'White', 'Silver', 'Blue', 'Red', 'Grey'];
const FASHION_SIZES = ['Small', 'Medium', 'Large', 'Extra Large'];
const SIZE_VARIANTS = ['Small', 'Medium', 'Large'];
const MINI_SIZES = ['Small', 'Large'];
const GROCERY_WEIGHTS = ['500g', '1kg', '2kg', '5kg'];
const VOLUME_ML = ['100ml', '250ml', '500ml'];
const STORAGE_GB = ['64GB', '128GB', '256GB'];

// Per-category product catalogue: a fixed list of realistic, brand-free nouns,
// the suffix variants that make sense for that category, and a realistic Naira
// price band. minNaira/maxNaira are whole Naira and are converted to kobo (x100)
// at generation time. Electronics is the widest band and its top is the global
// maximum of NGN 750,000; nothing exceeds that.
interface CategoryCatalog {
  nouns: string[];
  variants: string[];
  minNaira: number;
  maxNaira: number;
}

const PRODUCT_CATALOG: Record<string, CategoryCatalog> = {
  Electronics: {
    nouns: ['Television', 'Soundbar', 'Headphones', 'Camera', 'Projector', 'Monitor', 'Router', 'Amplifier', 'Microphone', 'Speaker'],
    variants: COLOUR_VARIANTS,
    minNaira: 15_000, maxNaira: 750_000,
  },
  'Phones & Tablets': {
    nouns: ['Smartphone', 'Tablet', 'Power Bank', 'Screen Protector', 'Phone Case', 'Wall Charger', 'Wireless Earbuds', 'Smartwatch', 'Phone Holder', 'Charging Cable'],
    variants: STORAGE_GB,
    minNaira: 12_000, maxNaira: 650_000,
  },
  'Computers & Accessories': {
    nouns: ['Laptop', 'Desktop Computer', 'Keyboard', 'Mouse', 'Printer', 'Scanner', 'External Hard Drive', 'Flash Drive', 'Webcam', 'USB Hub'],
    variants: COLOUR_VARIANTS,
    minNaira: 8_000, maxNaira: 700_000,
  },
  "Men's Fashion": {
    nouns: ['Shirt', 'Trousers', 'Suit', 'Jacket', 'T-Shirt', 'Polo Shirt', 'Jeans', 'Hoodie', 'Kaftan', 'Cap'],
    variants: FASHION_SIZES,
    minNaira: 3_000, maxNaira: 80_000,
  },
  "Women's Fashion": {
    nouns: ['Dress', 'Blouse', 'Skirt', 'Gown', 'Jumpsuit', 'Cardigan', 'Abaya', 'Wrapper', 'Scarf', 'Blazer'],
    variants: FASHION_SIZES,
    minNaira: 3_000, maxNaira: 80_000,
  },
  'Shoes & Bags': {
    nouns: ['Sneakers', 'Sandals', 'Loafers', 'Heels', 'Boots', 'Slippers', 'Backpack', 'Handbag', 'Tote Bag', 'Wallet'],
    variants: FASHION_SIZES,
    minNaira: 4_000, maxNaira: 120_000,
  },
  'Home & Kitchen': {
    nouns: ['Cookware Set', 'Frying Pan', 'Dinner Set', 'Cutlery Set', 'Water Bottle', 'Storage Container', 'Bed Sheet', 'Curtain', 'Rug', 'Wall Clock'],
    variants: SIZE_VARIANTS,
    minNaira: 2_000, maxNaira: 150_000,
  },
  Furniture: {
    nouns: ['Sofa', 'Dining Table', 'Office Chair', 'Bed Frame', 'Wardrobe', 'Bookshelf', 'Coffee Table', 'Study Desk', 'Cabinet', 'Stool'],
    variants: SIZE_VARIANTS,
    minNaira: 15_000, maxNaira: 600_000,
  },
  Appliances: {
    nouns: ['Refrigerator', 'Washing Machine', 'Microwave', 'Air Conditioner', 'Electric Kettle', 'Toaster', 'Blender', 'Vacuum Cleaner', 'Standing Fan', 'Gas Cooker'],
    variants: SIZE_VARIANTS,
    minNaira: 10_000, maxNaira: 500_000,
  },
  'Beauty & Personal Care': {
    nouns: ['Body Lotion', 'Face Cream', 'Shampoo', 'Conditioner', 'Perfume', 'Lipstick', 'Makeup Kit', 'Hair Dryer', 'Bath Soap', 'Face Serum'],
    variants: VOLUME_ML,
    minNaira: 1_000, maxNaira: 40_000,
  },
  'Health & Wellness': {
    nouns: ['Vitamin C', 'Multivitamin', 'Thermometer', 'Blood Pressure Monitor', 'Massage Gun', 'First Aid Kit', 'Protein Powder', 'Hand Sanitizer', 'Face Mask', 'Weighing Scale'],
    variants: VOLUME_ML,
    minNaira: 1_000, maxNaira: 60_000,
  },
  Groceries: {
    nouns: ['Rice', 'Beans', 'Palm Oil', 'Garri', 'Spaghetti', 'Semovita', 'Granulated Sugar', 'Milk Powder', 'Tomato Paste', 'Vegetable Oil'],
    variants: GROCERY_WEIGHTS,
    minNaira: 500, maxNaira: 20_000,
  },
  'Baby & Kids': {
    nouns: ['Baby Diapers', 'Baby Wipes', 'Feeding Bottle', 'Baby Stroller', 'Baby Cot', 'Baby Monitor', 'Kids Bicycle', 'Baby Carrier', 'Baby Bath Tub', 'Pacifier'],
    variants: MINI_SIZES,
    minNaira: 1_500, maxNaira: 80_000,
  },
  'Toys & Games': {
    nouns: ['Building Blocks', 'Jigsaw Puzzle', 'Action Figure', 'Board Game', 'Doll', 'Remote Control Car', 'Chess Set', 'Play Dough', 'Toy Train', 'Card Game'],
    variants: [],
    minNaira: 1_500, maxNaira: 100_000,
  },
  'Sports & Outdoors': {
    nouns: ['Football', 'Basketball', 'Yoga Mat', 'Dumbbell Set', 'Tennis Racket', 'Camping Tent', 'Bike Helmet', 'Jump Rope', 'Boxing Gloves', 'Badminton Racket'],
    variants: SIZE_VARIANTS,
    minNaira: 2_000, maxNaira: 150_000,
  },
  'Books & Stationery': {
    nouns: ['Notebook', 'Novel', 'Textbook', 'Pen Set', 'Pencil Case', 'Stapler', 'Calculator', 'Diary', 'Sticky Notes', 'Highlighter Set'],
    variants: [],
    minNaira: 500, maxNaira: 25_000,
  },
  Automotive: {
    nouns: ['Car Battery', 'Engine Oil', 'Car Tyre', 'Brake Pad', 'Car Floor Mats', 'Headlight Bulb', 'Wiper Blade', 'Car Charger', 'Air Filter', 'Spark Plug'],
    variants: [],
    minNaira: 2_500, maxNaira: 300_000,
  },
  'Pet Supplies': {
    nouns: ['Dog Food', 'Cat Food', 'Pet Collar', 'Pet Leash', 'Pet Bowl', 'Cat Litter', 'Pet Toy', 'Bird Cage', 'Fish Tank', 'Pet Grooming Kit'],
    variants: MINI_SIZES,
    minNaira: 1_000, maxNaira: 60_000,
  },
  'Tools & Industrial': {
    nouns: ['Hammer', 'Screwdriver Set', 'Cordless Drill', 'Wrench Set', 'Measuring Tape', 'Safety Helmet', 'Work Gloves', 'Toolbox', 'Angle Grinder', 'Paint Brush'],
    variants: [],
    minNaira: 2_500, maxNaira: 250_000,
  },
  'Musical Instruments': {
    nouns: ['Guitar', 'Digital Piano', 'Drum Set', 'Violin', 'Saxophone', 'Trumpet', 'Flute', 'Ukulele', 'Tambourine', 'Xylophone'],
    variants: [],
    minNaira: 5_000, maxNaira: 500_000,
  },
};

// Each template is one sentence that names the product noun, so a description
// can never talk about an unrelated product.
const DESCRIPTION_TEMPLATES: Array<(noun: string) => string> = [
  (noun) => `Reliable ${noun} for everyday use.`,
  (noun) => `Quality ${noun} at a fair price.`,
  (noun) => `Everyday ${noun} that does the job.`,
  (noun) => `This ${noun} offers good value for money.`,
  (noun) => `Durable ${noun} for daily needs.`,
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

  // 1. Categories: fixed names; ids generated in code like every other table.
  console.log(`[Seed] Inserting ${CATEGORY_NAMES.length} categories...`);
  const categories = CATEGORY_NAMES.map((name) => ({
    id: faker.string.uuid(),
    name,
    slug: slugify(name),
    createdAt: SEEDED_CREATED_AT,
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
      createdAt: SEEDED_CREATED_AT,
    };
  });
  await insertInBatches(customers, (batch) =>
    prisma.customer.createMany({ data: batch, skipDuplicates: true })
  );

  // 3. Products: names/descriptions come from the per-category catalogue, so a
  //    product always matches its category (a Groceries row is a rice/beans/
  //    garri-style item, never a tuna or a phone). Prices use a realistic
  //    per-category Naira band, stored in kobo (minor units): e.g. NGN 1,500 =
  //    150000 kobo. Distributed round-robin across categories so every category
  //    has stock.
  console.log(`[Seed] Inserting ${PRODUCT_COUNT} products...`);
  const products = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
    const category = categories[i % categories.length];
    const catalog = PRODUCT_CATALOG[category.name];
    if (!catalog) {
      // Fail loudly rather than silently seeding a category with no products.
      throw new Error(`No product catalogue defined for category "${category.name}"`);
    }

    const noun = faker.helpers.arrayElement(catalog.nouns);
    const adjective = faker.helpers.arrayElement(PRODUCT_ADJECTIVES);
    const hasVariant = catalog.variants.length > 0 && faker.number.int({ min: 0, max: 1 }) === 1;
    const variant = hasVariant ? faker.helpers.arrayElement(catalog.variants) : null;

    // Whole-naira prices (round to 100 kobo). The band top is at most the global
    // cap of NGN 750,000, so rounding can never push a price above it.
    const priceMinor =
      Math.round(faker.number.int({ min: catalog.minNaira * 100, max: catalog.maxNaira * 100 }) / 100) * 100;

    return {
      id: faker.string.uuid(),
      categoryId: category.id,
      name: variant ? `${adjective} ${noun} - ${variant}` : `${adjective} ${noun}`,
      description: faker.helpers.arrayElement(DESCRIPTION_TEMPLATES)(noun.toLowerCase()),
      priceMinor,
      currency: 'NGN',
      stock: faker.number.int({ min: 5, max: 300 }),
      createdAt: SEEDED_CREATED_AT,
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
