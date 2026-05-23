import { describe, it, expect, beforeEach } from 'vitest';
import { MinHeap } from './MinHeap.js';

describe('MinHeap', () => {
    let heap;

    beforeEach(() => {
        // Arrange: Start with a fresh heap for each test to ensure isolation
        heap = new MinHeap();
    });

    describe('API: length', () => {
        it('should report a length of 0 for a new heap', () => {
            // Act
            const result = heap.length;

            // Assert
            expect(result).toBe(0);
        });

        it('should reflect the number of elements currently in the heap', () => {
            // Arrange
            heap.push(['item1', 10]);
            heap.push(['item2', 5]);

            // Act
            const lengthAfterPush = heap.length;
            heap.pop();
            const lengthAfterPop = heap.length;

            // Assert
            expect(lengthAfterPush).toBe(2);
            expect(lengthAfterPop).toBe(1);
        });
    });

    describe('API: push', () => {
        it('should accept items with positive, negative, and zero priorities', () => {
            // Act
            heap.push(['zero', 0]);
            heap.push(['negative', -10]);
            heap.push(['positive', 10]);

            // Assert
            expect(heap.length).toBe(3);
            expect(heap.pop()).toEqual(['negative', -10]);
            expect(heap.pop()).toEqual(['zero', 0]);
            expect(heap.pop()).toEqual(['positive', 10]);
        });

        it('should handle multiple items with identical priorities', () => {
            // Arrange
            const priority = 42;
            const items = ['a', 'b', 'c'];

            // Act
            items.forEach((val) => heap.push([val, priority]));

            // Assert
            expect(heap.length).toBe(items.length);
            const results = [heap.pop(), heap.pop(), heap.pop()];
            const values = results.map((r) => r[0]);

            expect(results.every((r) => r[1] === priority)).toBe(true);
            expect(values).toContain('a');
            expect(values).toContain('b');
            expect(values).toContain('c');
        });
    });

    describe('API: pop', () => {
        it('should return undefined when the heap is empty', () => {
            // Act
            const result = heap.pop();

            // Assert
            expect(result).toBeUndefined();
        });

        it('should return the only element and empty the heap when length is 1', () => {
            // Arrange
            const item = ['only', 1];
            heap.push(item);

            // Act
            const result = heap.pop();

            // Assert
            expect(result).toEqual(item);
            expect(heap.length).toBe(0);
        });

        it('should always return the item with the minimum priority (ascending order)', () => {
            // Arrange
            const items = [
                ['medium', 10],
                ['lowest', 1],
                ['highest', 100],
                ['low', 5],
            ];

            // Act
            items.forEach((item) => heap.push(item));

            // Assert
            expect(heap.pop()).toEqual(['lowest', 1]);
            expect(heap.pop()).toEqual(['low', 5]);
            expect(heap.pop()).toEqual(['medium', 10]);
            expect(heap.pop()).toEqual(['highest', 100]);
        });
    });

    describe('Behavior under stress', () => {
        it('should maintain heap invariants through a large sequence of operations', () => {
            // Arrange: Generate a large deterministic set of values
            const count = 500;
            const input = Array.from({ length: count }, (_, i) => [
                `val-${i}`,
                (i * 137) % count, // Pseudo-random but deterministic
            ]);

            // Act: Push all items
            input.forEach((item) => heap.push(item));

            // Assert: Verify length
            expect(heap.length).toBe(count);

            // Act: Pop all items and verify order
            const sortedInput = [...input].sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < count; i++) {
                expect(heap.pop()).toEqual(sortedInput[i]);
            }
            expect(heap.length).toBe(0);
        });

        it('should handle items pushed in reverse-sorted order (worst case for push)', () => {
            // Arrange
            const count = 100;
            const input = Array.from({ length: count }, (_, i) => [
                `v-${count - i}`,
                count - i,
            ]);

            // Act
            input.forEach((item) => heap.push(item));

            // Assert
            for (let i = 1; i <= count; i++) {
                expect(heap.pop()).toEqual([`v-${i}`, i]);
            }
        });

        it('should handle items pushed in already-sorted order (best case for push)', () => {
            // Arrange
            const count = 100;
            const input = Array.from({ length: count }, (_, i) => [
                `v-${i}`,
                i,
            ]);

            // Act
            input.forEach((item) => heap.push(item));

            // Assert
            for (let i = 0; i < count; i++) {
                expect(heap.pop()).toEqual([`v-${i}`, i]);
            }
        });
    });
});
