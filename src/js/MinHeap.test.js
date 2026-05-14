import { describe, it, expect, beforeEach } from 'vitest';
import { MinHeap } from './MinHeap.js';

describe('MinHeap', () => {
    let heap;

    beforeEach(() => {
        heap = new MinHeap();
    });

    it('should initialize with length 0', () => {
        expect(heap.length).toBe(0);
    });

    it('should push elements and update length', () => {
        heap.push(['a', 10]);
        heap.push(['b', 5]);
        expect(heap.length).toBe(2);
    });

    it('should pop elements in ascending order of priority', () => {
        heap.push(['c', 15]);
        heap.push(['a', 10]);
        heap.push(['b', 5]);
        heap.push(['d', 20]);

        expect(heap.pop()).toEqual(['b', 5]);
        expect(heap.pop()).toEqual(['a', 10]);
        expect(heap.pop()).toEqual(['c', 15]);
        expect(heap.pop()).toEqual(['d', 20]);
        expect(heap.length).toBe(0);
    });

    it('should handle elements with same priority', () => {
        heap.push(['a', 10]);
        heap.push(['b', 10]);

        const first = heap.pop();
        const second = heap.pop();

        expect(first[1]).toBe(10);
        expect(second[1]).toBe(10);
        expect(heap.length).toBe(0);
    });

    it('should return undefined when popping from an empty heap and not change length', () => {
        expect(heap.pop()).toBeUndefined();
        expect(heap.length).toBe(0);
    });

    it('should handle a single element heap', () => {
        heap.push(['a', 10]);
        expect(heap.pop()).toEqual(['a', 10]);
        expect(heap.length).toBe(0);
    });

    it('should maintain heap property after complex operations', () => {
        const values = [
            ['e', 50],
            ['a', 10],
            ['c', 30],
            ['b', 20],
            ['d', 40],
            ['f', 5],
            ['g', 15],
            ['h', 25],
            ['i', 35],
            ['j', 45],
        ];

        values.forEach((v) => heap.push(v));

        const sorted = [...values].sort((a, b) => a[1] - b[1]);

        sorted.forEach((expected) => {
            expect(heap.pop()).toEqual(expected);
        });

        expect(heap.length).toBe(0);
    });

    it('should handle negative priorities', () => {
        heap.push(['a', -10]);
        heap.push(['b', -20]);
        heap.push(['c', 0]);

        expect(heap.pop()).toEqual(['b', -20]);
        expect(heap.pop()).toEqual(['a', -10]);
        expect(heap.pop()).toEqual(['c', 0]);
    });

    it('should work correctly with a large number of elements', () => {
        const count = 1000;
        const input = [];
        for (let i = 0; i < count; i++) {
            const val = Math.floor(Math.random() * 10000);
            input.push([`val${i}`, val]);
            heap.push(input[i]);
        }

        expect(heap.length).toBe(count);

        const sortedInput = [...input].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < count; i++) {
            expect(heap.pop()[1]).toBe(sortedInput[i][1]);
        }
        expect(heap.length).toBe(0);
    });
});
