import { describe, it, expect } from 'vitest';
import { NetworkMetrics } from './NetworkMetrics.js';
import createGraph from 'ngraph.graph';

describe('NetworkMetrics', () => {
    describe('calculateReciprocity', () => {
        it('should calculate reciprocity correctly for a simple reciprocated pair', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 2 });
            graph.addLink('G4', 'C4', { weight: 1 });

            const n = 2;
            const edgeCount = 2;
            const density = edgeCount / (n * (n - 1));

            // Act
            const metrics = NetworkMetrics.calculateReciprocity(
                graph,
                edgeCount,
                density,
            );

            // Assert
            // weighted reciprocity = sum(min(w_ij, w_ji)) / sum(w_ij)
            // sum(min) = min(2,1) + min(1,2) = 1 + 1 = 2
            // sum(w) = 2 + 1 = 3
            // reciprocity = 2/3 = 0.6667
            expect(metrics.reciprocity).toBe('0.6667');
            expect(metrics.binaryReciprocity).toBe('1.0000');
            expect(metrics.reciprocityRho).toBe('0.0000');
        });

        it('should handle zero reciprocity for a directed chain', () => {
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

        it('should return 0 for reciprocityRho when density is 1', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'B', { weight: 1 });
            graph.addLink('B', 'A', { weight: 1 });
            // density = 2 / (2 * 1) = 1.0

            // Act
            const metrics = NetworkMetrics.calculateReciprocity(graph, 2, 1.0);

            // Assert
            expect(metrics.reciprocityRho).toBe('0.0000');
        });
    });

    describe('calculateEntropy', () => {
        it('should calculate mean node entropy correctly', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('G4', 'C4', { weight: 1 });
            graph.addLink('C4', 'E4', { weight: 1 });
            graph.addLink('E4', 'C4', { weight: 1 });

            // Act
            // Node C4: out-weight 2, transitions [1, 1]. p = [0.5, 0.5]. H = 1.0
            // Node G4: out-weight 1, transitions [1]. p = [1.0]. H = 0
            // Node E4: out-weight 1, transitions [1]. p = [1.0]. H = 0
            // Mean Entropy = (1.0 + 0 + 0) / 3 = 0.3333
            const entropy = NetworkMetrics.calculateEntropy(graph, 3);

            // Assert
            expect(entropy).toBe('0.3333');
        });

        it('should handle zero entropy for single transitions', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'B', { weight: 10 });

            // Act
            const entropy = NetworkMetrics.calculateEntropy(graph, 2);

            // Assert
            expect(entropy).toBe('0.0000');
        });

        it('should handle nodes with no outgoing links', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A');

            // Act
            const entropy = NetworkMetrics.calculateEntropy(graph, 1);

            // Assert
            expect(entropy).toBe('0.0000');
        });
    });

    describe('calculateEfficiency', () => {
        it('should calculate unweighted and weighted efficiency for a reciprocated pair', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('G4', 'C4', { weight: 1 });

            // Act
            // n=2, norm = 2 * (2-1) = 2
            // d(C4, G4) = 1, d(G4, C4) = 1
            // sum(1/d) = 1/1 + 1/1 = 2
            // efficiency = 2 / 2 = 1.0
            const metrics = NetworkMetrics.calculateEfficiency(graph, 2);

            // Assert
            expect(metrics.efficiency).toBe('1.0000');
            expect(metrics.weightedEfficiency).toBe('1.0000');
        });

        it('should calculate weighted efficiency with non-unit weights', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 2 });
            graph.addLink('G4', 'C4', { weight: 1 });

            // Act
            // n=2, norm = 2
            // Weighted Distance d_w = 1/weight
            // d_w(C4, G4) = 1/2 = 0.5
            // d_w(G4, C4) = 1/1 = 1.0
            // sum(1/d_w) = 1/0.5 + 1/1.0 = 2 + 1 = 3
            // weightedEfficiency = 3 / 2 = 1.5000
            const metrics = NetworkMetrics.calculateEfficiency(graph, 2);

            // Assert
            expect(metrics.weightedEfficiency).toBe('1.5000');
        });

        it('should handle disconnected components and isolated nodes', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('C4', 'G4', { weight: 1 });
            graph.addLink('A4', 'B4', { weight: 1 });
            graph.addNode('E4'); // Isolated node

            // Act
            // n=5, norm = 5 * 4 = 20
            // Paths: (C4,G4), (A4,B4)
            // Efficiency = (1/1 + 1/1) / 20 = 2/20 = 0.1
            const metrics = NetworkMetrics.calculateEfficiency(graph, 5);

            // Assert
            expect(metrics.efficiency).toBe('0.1000');
        });

        it('should return 0 for efficiency when n <= 1', () => {
            const graph = createGraph();
            graph.addNode('A');
            const metrics = NetworkMetrics.calculateEfficiency(graph, 1);
            expect(metrics.efficiency).toBe('0.0000');
        });
    });

    describe('calculateEmbedding', () => {
        it('should calculate normalized 12D scale-interval embedding', () => {
            // Arrange
            const graph = createGraph();
            // C4 (48) -> G4 (55) => 7 semitones
            graph.addLink('C4', 'G4', { weight: 1 });
            // G4 (55) -> C4 (48) => -7 semitones => 5 semitones (mod 12)
            graph.addLink('G4', 'C4', { weight: 1 });

            // Act
            const embedding = NetworkMetrics.calculateEmbedding(graph);

            // Assert
            // Vector has 1 at index 7 and index 5. Normalized (L2): sqrt(1^2 + 1^2) = sqrt(2). 1/sqrt(2) approx 0.7071
            expect(embedding[7]).toBe('0.7071');
            expect(embedding[5]).toBe('0.7071');
        });

        it('should return all zeros for an empty graph', () => {
            // Arrange
            const graph = createGraph();

            // Act
            const embedding = NetworkMetrics.calculateEmbedding(graph);

            // Assert
            expect(embedding.every((v) => v === '0.0000')).toBe(true);
            expect(embedding.length).toBe(12);
        });
    });

    describe('Graph Algorithms Internal Helpers', () => {
        it('should handle nodes with no outgoing links in BFS and Dijkstra', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A');
            graph.addNode('B');
            graph.addLink('C', 'A', { weight: 1 }); // C has outgoing, A and B don't

            const adj = NetworkMetrics._getAdjacencyList(graph);

            // Act
            const bfsDist = NetworkMetrics.bfsDistances(adj, 'A');
            const dijkstraDist = NetworkMetrics.dijkstraDistances(adj, 'A');

            // Assert
            expect(bfsDist.get('A')).toBe(0);
            expect(bfsDist.size).toBe(1);
            expect(dijkstraDist.get('A')).toBe(0);
            expect(dijkstraDist.size).toBe(1);
        });

        it('should use default weight of 1 if link weight is missing in Dijkstra', () => {
            // Arrange
            const graph = createGraph();
            // Manually add a link without weight in data
            graph.addLink('A', 'B', {});

            const adj = NetworkMetrics._getAdjacencyList(graph);

            // Act
            const distances = NetworkMetrics.dijkstraDistances(adj, 'A');

            // Assert
            // alt = d + 1 / weight. d=0, weight defaults to 1. alt = 1.
            expect(distances.get('B')).toBe(1);
        });
    });

    describe('calculateAll', () => {
        it('should aggregate all metrics into a summary object', () => {
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
            expect(metrics.efficiency).toBe('0.5000'); // (1/1) / (2 * 1) = 0.5
        });

        it('should handle edge case of 0 nodes', () => {
            const graph = createGraph();
            const metrics = NetworkMetrics.calculateAll(graph, 0);
            expect(metrics.vertices).toBe(0);
            expect(metrics.density).toBe('0.0000');
        });

        it('should handle edge case of 1 node', () => {
            const graph = createGraph();
            graph.addNode('A');
            const metrics = NetworkMetrics.calculateAll(graph, 0);
            expect(metrics.vertices).toBe(1);
            expect(metrics.density).toBe('0.0000');
        });
    });
});
