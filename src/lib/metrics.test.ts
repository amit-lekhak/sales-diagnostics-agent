import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

const hasDb = Boolean(process.env.DATABASE_URL);

describe('getMetric product vs store', { skip: !hasDb }, () => {
  it('productId path returns a finite value for ShieldGuard last month', async () => {
    const { resolveProduct } = await import('./dimensions');
    const { getMetric } = await import('./metrics');
    const { lastMonth } = await import('./dates');
    const productId = await resolveProduct({ productName: 'ShieldGuard Soap' });
    assert.ok(productId != null);
    const row = await getMetric('net_sales', {
      ...lastMonth(),
      productId: productId!,
    });
    assert.ok(Number.isFinite(row.value));
    assert.match(row.display, /₹/);
    assert.equal(row.filters.productId, productId);
  });
});
