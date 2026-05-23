import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from './ObjectPool.js';

describe('ObjectPool', () => {
    it('should create a new item if pool is empty', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);

        const item = pool.acquire();

        expect(createFn).toHaveBeenCalledOnce();
        expect(item).toEqual({ id: 'new' });
    });

    it('should reuse an item if pool has one', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);

        const item1 = pool.acquire();
        pool.release(item1);

        const item2 = pool.acquire();

        expect(createFn).toHaveBeenCalledTimes(1);
        expect(item2).toBe(item1);
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
        pool.acquire(2); // item2 unused

        const item3 = pool.acquire(3);

        // item1 was recycled to become item3
        expect(item3).toBe(item1);
        expect(item3.id).toBe(3);
        expect(releaseFn).toHaveBeenCalledWith(item1);
    });

    it('should completely clear pool and active items and call disposeFn', () => {
        const createFn = vi.fn((id) => ({ id }));
        const pool = new ObjectPool(createFn);

        const item1 = pool.acquire(1);
        const item2 = pool.acquire(2);
        pool.release(item2);

        const disposeFn = vi.fn();
        pool.clear((item) => disposeFn(item));

        expect(disposeFn).toHaveBeenCalledTimes(2);
        expect(disposeFn).toHaveBeenCalledWith(item1);
        expect(disposeFn).toHaveBeenCalledWith(item2);

        // Verify it's cleared by ensuring next acquire creates a new item
        const item3 = pool.acquire(3);
        expect(item3).not.toBe(item1);
        expect(item3).not.toBe(item2);
    });

    it('should safely do nothing when releasing un-tracked item', () => {
        const createFn = vi.fn(() => ({ id: 'new' }));
        const pool = new ObjectPool(createFn);
        const item = pool.acquire();

        expect(() => pool.release({ id: 'fake' })).not.toThrow();

        // Ensure the tracked item is still there and can be released
        pool.release(item);
        const item2 = pool.acquire();
        expect(item2).toBe(item);
    });

    it('should clear without disposeFn', () => {
        const createFn = vi.fn((id) => ({ id }));
        const pool = new ObjectPool(createFn);
        const item1 = pool.acquire(1);
        pool.release(item1);

        expect(() => pool.clear()).not.toThrow();

        const item2 = pool.acquire(2);
        expect(item2).not.toBe(item1);
    });

    it('should work without optional functions', () => {
        const createFn = vi.fn(() => ({}));
        const pool = new ObjectPool(createFn);

        const item = pool.acquire();
        expect(createFn).toHaveBeenCalled();

        expect(() => pool.release(item)).not.toThrow();

        const item2 = pool.acquire();
        expect(item2).toBe(item);
    });

    it('should pass multiple arguments to createFn and resetFn', () => {
        const createFn = vi.fn((a, b) => ({ a, b }));
        const resetFn = vi.fn();
        const pool = new ObjectPool(createFn, resetFn);

        const item = pool.acquire('arg1', 'arg2');

        expect(createFn).toHaveBeenCalledWith('arg1', 'arg2');
        expect(resetFn).toHaveBeenCalledWith(item, 'arg1', 'arg2');
        expect(item).toEqual({ a: 'arg1', b: 'arg2' });
    });

    it('should allow releasing by index', () => {
        const createFn = (id) => ({ id });
        const resetFn = (item, id) => {
            item.id = id;
        };
        const pool = new ObjectPool(createFn, resetFn);
        const item1 = pool.acquire(1);
        pool.acquire(2);

        pool.releaseIndex(0); // Releases item1

        const item3 = pool.acquire(3);
        expect(item3).toBe(item1); // Reused item1
        expect(item3.id).toBe(3); // Reset to 3
    });
});
