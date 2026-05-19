import { describe, it, expect, beforeEach } from 'vitest';
import { MinHeap } from './MinHeap.js';

describe('MinHeap', () => {
    let heap;

    beforeEach(() => {
        // Arrange: Prepare a clean test environment before each test
        heap = new MinHeap();
    });

    describe('Initialization', () => {
        it('should initialize with length 0', () => {
            // Act
            const length = heap.length;

            // Assert
            expect(length).toBe(0);
        });
    });

    describe('Pushing Elements', () => {
        it('should increment length when elements are pushed', () => {
            // Act
            heap.push(['a', 10]);
            heap.push(['b', 5]);

            // Assert
            expect(heap.length).toBe(2);
        });

        it('should handle elements with the same priority (edge case)', () => {
            // Arrange
            heap.push(['a', 10]);
            heap.push(['b', 10]);

            // Act
            const first = heap.pop();
            const second = heap.pop();

            // Assert
            expect(first[1]).toBe(10);
            expect(second[1]).toBe(10);
            expect(heap.length).toBe(0);
        });

        it('should handle negative priorities (edge case)', () => {
            // Arrange
            heap.push(['a', -10]);
            heap.push(['b', -20]);
            heap.push(['c', 0]);

            // Act & Assert
            expect(heap.pop()).toEqual(['b', -20]);
            expect(heap.pop()).toEqual(['a', -10]);
            expect(heap.pop()).toEqual(['c', 0]);
        });
    });

    describe('Popping Elements', () => {
        it('should return undefined when popping from an empty heap (boundary condition)', () => {
            // Act
            const result = heap.pop();

            // Assert
            expect(result).toBeUndefined();
            expect(heap.length).toBe(0);
        });

        it('should return the only element and reduce length to 0 when popping a single-element heap', () => {
            // Arrange
            heap.push(['a', 10]);

            // Act
            const result = heap.pop();

            // Assert
            expect(result).toEqual(['a', 10]);
            expect(heap.length).toBe(0);
        });

        it('should pop elements in ascending order of priority', () => {
            // Arrange
            heap.push(['c', 15]);
            heap.push(['a', 10]);
            heap.push(['b', 5]);
            heap.push(['d', 20]);

            // Act & Assert
            expect(heap.pop()).toEqual(['b', 5]);
            expect(heap.pop()).toEqual(['a', 10]);
            expect(heap.pop()).toEqual(['c', 15]);
            expect(heap.pop()).toEqual(['d', 20]);
            expect(heap.length).toBe(0);
        });
    });

    describe('Complex Operations & Extreme Use Patterns', () => {
        it('should maintain heap property after multiple mixed push operations', () => {
            // Arrange
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

            // Act
            values.forEach((v) => heap.push(v));

            // Assert
            const sorted = [...values].sort((a, b) => a[1] - b[1]);
            sorted.forEach((expected) => {
                expect(heap.pop()).toEqual(expected);
            });
            expect(heap.length).toBe(0);
        });

        it('should work correctly with a large number of elements (load testing)', () => {
            // Arrange
            const count = 1000;
            const input = [];
            for (let i = 0; i < count; i++) {
                const val = Math.floor(Math.random() * 10000);
                input.push([`val${i}`, val]);
                heap.push(input[i]);
            }

            // Act
            const finalLength = heap.length;

            // Assert
            expect(finalLength).toBe(count);

            const sortedInput = [...input].sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < count; i++) {
                expect(heap.pop()[1]).toBe(sortedInput[i][1]);
            }
            expect(heap.length).toBe(0);
        });
    });
});
