import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool.js';

describe('ObjectPool', () => {
    it('should create a new item if pool is empty', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);

        const item = pool.acquire();

        expect(createFn).toHaveBeenCalled();
        expect(item).toEqual({ id: 'new' });
        expect(pool.active.length).toBe(1);
        expect(pool.pool.length).toBe(0);
    });

    it('should reuse an item if pool has one', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);

        const item1 = pool.acquire();
        pool.release(item1);

        expect(pool.active.length).toBe(0);
        expect(pool.pool.length).toBe(1);

        const item2 = pool.acquire();

        expect(createFn).toHaveBeenCalledTimes(1); // Not called again
        expect(item2).toBe(item1); // Exact same reference
        expect(pool.active.length).toBe(1);
        expect(pool.pool.length).toBe(0);
    });

    it('should call resetFn when acquiring', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const resetFn = vi.fn((item, data) => {
            item.data = data;
        });
        const pool = new ObjectPool(createFn, resetFn);

        const item = pool.acquire('test data');

        expect(resetFn).toHaveBeenCalledWith(item, 'test data');
        expect(item.data).toBe('test data');
    });

    it('should call releaseFn when releasing', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const releaseFn = vi.fn();
        const pool = new ObjectPool(createFn, null, releaseFn);

        const item = pool.acquire();
        pool.release(item);

        expect(releaseFn).toHaveBeenCalledWith(item);
    });

    it('should respect maxActive limit by recycling oldest', () => {
        const createFn = vi.fn((id) => ({ id }));
        const resetFn = vi.fn((item, id) => {
            item.id = id;
        });
        const releaseFn = vi.fn();
        const pool = new ObjectPool(createFn, resetFn, releaseFn, 2);

        const item1 = pool.acquire(1);
        const item2 = pool.acquire(2);

        expect(pool.active.length).toBe(2);

        const item3 = pool.acquire(3);

        expect(pool.active.length).toBe(2);
        expect(pool.active).toContain(item2);
        expect(pool.active).toContain(item3);
        // item1 was recycled to become item3
        expect(item3).toBe(item1);
        expect(item3.id).toBe(3);
        expect(releaseFn).toHaveBeenCalledWith(item1);
    });

    it('should completely clear pool and active items and call disposeFn', () => {
        const createFn = vi.fn((id) => ({ id }));
        const pool = new ObjectPool(createFn);

        pool.acquire(1);
        const item2 = pool.acquire(2);
        pool.release(item2);

        expect(pool.active.length).toBe(1);
        expect(pool.pool.length).toBe(1);

        const disposeFn = vi.fn();
        pool.clear(disposeFn);

        expect(pool.active.length).toBe(0);
        expect(pool.pool.length).toBe(0);
        expect(disposeFn).toHaveBeenCalledTimes(2);
    });

    it('should safely do nothing when releasing un-tracked item', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);
        pool.acquire();

        pool.release({ id: 'fake' }); // Should not crash

        expect(pool.active.length).toBe(1);
        expect(pool.pool.length).toBe(0);
    });
});
