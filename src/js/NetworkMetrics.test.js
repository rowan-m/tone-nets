import { describe, it, expect } from 'vitest';
import { NetworkMetrics } from './NetworkMetrics.js';
import createGraph from 'ngraph.graph';

describe('NetworkMetrics', () => {
    describe('calculateReciprocity', () => {
        it('calculates weighted reciprocity for a simple reciprocated pair', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 2 });
            graph.addLink('G4', 'C4', { weight: 1 });
            const edgeCount = 2;
            const density = 2 / (2 * 1); // n=2

            // Act
            const metrics = NetworkMetrics.calculateReciprocity(
                graph,
                edgeCount,
                density,
            );

            // Assert
            // sum(min(w_ij, w_ji)) = min(2,1) + min(1,2) = 1 + 1 = 2
            // sum(w_ij) = 2 + 1 = 3
            // reciprocity = 2/3 ≈ 0.6667
            expect(metrics.reciprocity).toBe('0.6667');
            expect(metrics.binaryReciprocity).toBe('1.0000');
            expect(metrics.reciprocityRho).toBe('0.0000');
        });

        it('handles zero reciprocity for a directed chain', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('G4', 'E4', { weight: 1 });

            // Act
            const metrics = NetworkMetrics.calculateReciprocity(graph, 2, 0.5);

            // Assert
            expect(metrics.reciprocity).toBe('0.0000');
            expect(metrics.binaryReciprocity).toBe('0.0000');
        });

        it('returns 0 for reciprocityRho when density is 1', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'B', { weight: 1 });
            graph.addLink('B', 'A', { weight: 1 });

            // Act
            const metrics = NetworkMetrics.calculateReciprocity(graph, 2, 1.0);

            // Assert
            expect(metrics.reciprocityRho).toBe('0.0000');
        });

        it('handles empty graphs with zero reciprocity', () => {
            const graph = createGraph();
            const metrics = NetworkMetrics.calculateReciprocity(graph, 0, 0);
            expect(metrics.reciprocity).toBe('0.0000');
            expect(metrics.binaryReciprocity).toBe('0.0000');
            expect(metrics.reciprocityRho).toBe('0.0000');
        });
    });

    describe('calculateEntropy', () => {
        it('calculates mean node entropy correctly', () => {
            // Arrange
            const graph = createGraph();
            // Node C4: 2 outgoing links to G4 and E4, weights 1 each.
            // p = [0.5, 0.5], H = -(0.5*log2(0.5) + 0.5*log2(0.5)) = 1.0
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('C4', 'E4', { weight: 1 });
            // Node G4: 1 outgoing link, p = [1.0], H = 0
            graph.addLink('G4', 'C4', { weight: 1 });
            // Node E4: 1 outgoing link, p = [1.0], H = 0
            graph.addLink('E4', 'C4', { weight: 1 });

            // Act
            // Mean Entropy = (1.0 + 0 + 0) / 3 = 0.3333
            const entropy = NetworkMetrics.calculateEntropy(graph, 3);

            // Assert
            expect(entropy).toBe('0.3333');
        });

        it('returns 0 for nodes with single transitions or isolated nodes', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'B', { weight: 10 });
            graph.addNode('C');

            // Act
            const entropy = NetworkMetrics.calculateEntropy(graph, 3);

            // Assert
            expect(entropy).toBe('0.0000');
        });

        it('handles zero weight links gracefully', () => {
            const graph = createGraph();
            graph.addLink('A', 'B', { weight: 0 });
            expect(NetworkMetrics.calculateEntropy(graph, 2)).toBe('0.0000');
        });

        it('returns 0 for an empty graph', () => {
            const graph = createGraph();
            expect(NetworkMetrics.calculateEntropy(graph, 0)).toBe('0.0000');
        });
    });

    describe('calculateEfficiency', () => {
        it('calculates global and weighted efficiency for a reciprocated pair', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('G4', 'C4', { weight: 1 });

            // Act
            // n=2, norm = 2 * (2-1) = 2
            // d(C4, G4) = 1, d(G4, C4) = 1
            // Efficiency = (1/1 + 1/1) / 2 = 1.0
            const metrics = NetworkMetrics.calculateEfficiency(graph, 2);

            // Assert
            expect(metrics.efficiency).toBe('1.0000');
            expect(metrics.weightedEfficiency).toBe('1.0000');
        });

        it('calculates weighted efficiency with different transition weights', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 2 }); // d_w = 1/2 = 0.5
            graph.addLink('G4', 'C4', { weight: 1 }); // d_w = 1/1 = 1.0

            // Act
            // sum(1/d_w) = 1/0.5 + 1/1.0 = 2 + 1 = 3
            // norm = 2
            // Weighted Efficiency = 3 / 2 = 1.5000
            const metrics = NetworkMetrics.calculateEfficiency(graph, 2);

            // Assert
            expect(metrics.weightedEfficiency).toBe('1.5000');
        });

        it('handles disconnected components and isolated nodes', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C', 'G', { weight: 1 });
            graph.addLink('A', 'B', { weight: 1 });
            graph.addNode('E'); // Isolated

            // Act
            // n=5, norm = 5 * 4 = 20
            // Paths: (C,G) dist 1, (A,B) dist 1.
            // Efficiency = (1/1 + 1/1) / 20 = 0.1000
            const metrics = NetworkMetrics.calculateEfficiency(graph, 5);

            // Assert
            expect(metrics.efficiency).toBe('0.1000');
            expect(metrics.weightedEfficiency).toBe('0.1000');
        });

        it('correctly handles multiple paths in weighted efficiency (Dijkstra check)', () => {
            // Arrange
            const graph = createGraph();
            // Short path: A -> B (weight 0.5) => distance 2
            // Long path: A -> C -> B (weights 1, 1) => distance 1 + 1 = 2
            // Let's make the indirect path SHORTER in weight-space:
            // A -> B (weight 0.2) => d=5
            // A -> C (weight 1) => d=1, C -> B (weight 1) => d=1. Total d=2.
            graph.addLink('A', 'B', { weight: 0.2 });
            graph.addLink('A', 'C', { weight: 1 });
            graph.addLink('C', 'B', { weight: 1 });

            // Act
            // n=3, norm = 3 * 2 = 6
            // Paths from A:
            // d_w(A,B) = 2 (via C)
            // d_w(A,C) = 1
            // Efficiency from A = 1/2 + 1/1 = 1.5
            // Paths from C:
            // d_w(C,B) = 1
            // Efficiency from C = 1/1 = 1.0
            // Paths from B: none
            // Total sum(1/d_w) = 1.5 + 1.0 = 2.5
            // Weighted Efficiency = 2.5 / 6 ≈ 0.4167
            const metrics = NetworkMetrics.calculateEfficiency(graph, 3);

            // Assert
            expect(metrics.weightedEfficiency).toBe('0.4167');
            // Unweighted check: A->B is 1 hop. A->C is 1 hop. C->B is 1 hop.
            // Paths from A: d(A,B)=1, d(A,C)=1. Efficiency from A = 1/1 + 1/1 = 2.
            // Paths from C: d(C,B)=1. Efficiency from C = 1.
            // Total Efficiency = (2 + 1) / 6 = 0.5000
            expect(metrics.efficiency).toBe('0.5000');
        });

        it('returns 0 for efficiency when n <= 1', () => {
            const graph = createGraph();
            graph.addNode('A');
            const metrics = NetworkMetrics.calculateEfficiency(graph, 1);
            expect(metrics.efficiency).toBe('0.0000');
        });

        it('uses default weight of 1 if link weight is missing', () => {
            // Arrange
            const graph = createGraph();
            // Manually add a link without weight in data to test robustness
            graph.addLink('A', 'B', {});

            // Act
            // n=2, norm=2. d_w(A,B)=1/1=1. Efficiency = (1/1)/2 = 0.5
            const metrics = NetworkMetrics.calculateEfficiency(graph, 2);

            // Assert
            expect(metrics.weightedEfficiency).toBe('0.5000');
        });
    });

    describe('calculateEmbedding', () => {
        it('calculates normalized 12D scale-interval embedding', () => {
            // Arrange
            const graph = createGraph();
            // C4 (48) -> G4 (55) => +7 semitones
            graph.addLink('C4', 'G4', { weight: 1 });
            // G4 (55) -> C4 (48) => -7 semitones => 5 semitones (mod 12)
            graph.addLink('G4', 'C4', { weight: 1 });

            // Act
            const embedding = NetworkMetrics.calculateEmbedding(graph);

            // Assert
            // Vector: index 7 has 1, index 5 has 1. Others 0.
            // L2 norm: sqrt(1^2 + 1^2) = sqrt(2) ≈ 1.4142
            // Normalized values: 1/1.4142 ≈ 0.7071
            expect(embedding[7]).toBe('0.7071');
            expect(embedding[5]).toBe('0.7071');
            expect(embedding).toHaveLength(12);
        });

        it('returns all zeros for an empty graph or zero weight links', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'D4', { weight: 0 });

            // Act
            const embedding = NetworkMetrics.calculateEmbedding(graph);

            // Assert
            expect(embedding.every((v) => v === '0.0000')).toBe(true);
        });
    });

    describe('calculateAll', () => {
        it('aggregates all metrics into a summary object', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });

            // Act
            const metrics = NetworkMetrics.calculateAll(graph, 1);

            // Assert
            expect(metrics.vertices).toBe(2);
            expect(metrics.edges).toBe(1);
            expect(metrics.density).toBe('0.5000'); // 1 / (2 * 1)
            expect(metrics.reciprocity).toBe('0.0000');
            expect(metrics.entropy).toBe('0.0000');
            expect(metrics.efficiency).toBe('0.5000');
            expect(metrics.embedding).toBeDefined();
        });

        it('handles edge cases of 0 or 1 nodes', () => {
            const graph0 = createGraph();
            const metrics0 = NetworkMetrics.calculateAll(graph0, 0);
            expect(metrics0.vertices).toBe(0);
            expect(metrics0.density).toBe('0.0000');

            const graph1 = createGraph();
            graph1.addNode('A');
            const metrics1 = NetworkMetrics.calculateAll(graph1, 0);
            expect(metrics1.vertices).toBe(1);
            expect(metrics1.density).toBe('0.0000');
        });
    });
});
