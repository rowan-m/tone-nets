import { describe, it, expect } from 'vitest';
import { NetworkMetrics } from './NetworkMetrics.js';
import createGraph from 'ngraph.graph';

describe('NetworkMetrics', () => {
    it('should calculate reciprocity correctly', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 2 });
        graph.addLink('G4', 'C4', { weight: 1 });

        const n = 2;
        const edgeCount = 2;
        const density = edgeCount / (n * (n - 1));

        const metrics = NetworkMetrics.calculateReciprocity(
            graph,
            edgeCount,
            density,
        );

        // weighted reciprocity = sum(min(w_ij, w_ji)) / sum(w_ij)
        // sum(min) = min(2,1) + min(1,2) = 1 + 1 = 2
        // sum(w) = 2 + 1 = 3
        // reciprocity = 2/3 = 0.6667
        expect(metrics.reciprocity).toBe('0.6667');
        expect(metrics.binaryReciprocity).toBe('1.0000');
        expect(metrics.reciprocityRho).toBe('0.0000');
    });

    it('should calculate entropy correctly', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 1 });
        graph.addLink('G4', 'C4', { weight: 1 });
        graph.addLink('C4', 'E4', { weight: 1 });
        graph.addLink('E4', 'C4', { weight: 1 });

        // Node C4: out-weight 2, transitions [1, 1]. p = [0.5, 0.5]. H = 1.0
        // Node G4: out-weight 1, transitions [1]. p = [1.0]. H = 0
        // Node E4: out-weight 1, transitions [1]. p = [1.0]. H = 0
        // Mean Entropy = (1.0 + 0 + 0) / 3 = 0.3333
        const entropy = NetworkMetrics.calculateEntropy(graph, 3);
        expect(entropy).toBe('0.3333');
    });

    it('should calculate efficiency correctly', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 1 });
        graph.addLink('G4', 'C4', { weight: 1 });

        // n=2, norm = 2 * (2-1) = 2
        // d(C4, G4) = 1, d(G4, C4) = 1
        // sum(1/d) = 1/1 + 1/1 = 2
        // efficiency = 2 / 2 = 1.0
        const metrics = NetworkMetrics.calculateEfficiency(graph, 2);
        expect(metrics.efficiency).toBe('1.0000');
        expect(metrics.weightedEfficiency).toBe('1.0000');
    });

    it('should calculate weighted efficiency with different weights', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 2 });
        graph.addLink('G4', 'C4', { weight: 1 });

        // n=2, norm = 2
        // Weighted Distance d_w = 1/weight
        // d_w(C4, G4) = 1/2 = 0.5
        // d_w(G4, C4) = 1/1 = 1.0
        // sum(1/d_w) = 1/0.5 + 1/1.0 = 2 + 1 = 3
        // weightedEfficiency = 3 / 2 = 1.5000
        const metrics = NetworkMetrics.calculateEfficiency(graph, 2);
        expect(metrics.weightedEfficiency).toBe('1.5000');
    });

    it('should calculate interval embedding correctly', () => {
        const graph = createGraph();
        // C4 (48) -> G4 (55) => 7 semitones
        graph.addLink('C4', 'G4', { weight: 1 });
        // G4 (55) -> C4 (48) => -7 semitones => 5 semitones (mod 12)
        graph.addLink('G4', 'C4', { weight: 1 });

        const embedding = NetworkMetrics.calculateEmbedding(graph);
        // Vector has 1 at index 7 and index 5. Normalized (L2): sqrt(1^2 + 1^2) = sqrt(2). 1/sqrt(2) approx 0.7071
        expect(embedding[7]).toBe('0.7071');
        expect(embedding[5]).toBe('0.7071');
    });

    it('should handle disconnected nodes in efficiency', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 1 });
        graph.addLink('A4', 'B4', { weight: 1 });
        graph.addNode('E4'); // Isolated node

        // n=5, norm = 5 * 4 = 20
        // Paths: (C4,G4), (A4,B4)
        // Efficiency = (1/1 + 1/1) / 20 = 2/20 = 0.1
        const metrics = NetworkMetrics.calculateEfficiency(graph, 5);
        expect(metrics.efficiency).toBe('0.1000');
    });

    it('should aggregate all metrics in calculateAll', () => {
        const graph = createGraph();
        graph.addLink('C4', 'G4', { weight: 1 });

        const metrics = NetworkMetrics.calculateAll(graph, 1);
        expect(metrics.vertices).toBe(2);
        expect(metrics.edges).toBe(1);
        expect(metrics.density).toBe('0.5000'); // 1 / (2 * 1)
        expect(metrics.reciprocity).toBe('0.0000');
    });

    describe('Edge Cases', () => {
        it('should handle empty graph', () => {
            const graph = createGraph();
            const metrics = NetworkMetrics.calculateAll(graph, 0);
            expect(metrics.vertices).toBe(0);
            expect(metrics.edges).toBe(0);
            expect(metrics.density).toBe('0.0000');
            expect(metrics.efficiency).toBe('0.0000');
        });

        it('should handle single node graph', () => {
            const graph = createGraph();
            graph.addNode('C4');
            const metrics = NetworkMetrics.calculateAll(graph, 0);
            expect(metrics.vertices).toBe(1);
            expect(metrics.edges).toBe(0);
            expect(metrics.density).toBe('0.0000');
            expect(metrics.efficiency).toBe('0.0000');
        });
    });
});
