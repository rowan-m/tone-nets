import { Utils } from './Utils.js';
import { MinHeap } from './MinHeap.js';

/**
 * Handles all graph-theoretic metric calculations for the music network.
 * Separated from the parser to follow SRP.
 */
export class NetworkMetrics {
    /**
     * Calculates binary, weighted, and normalized reciprocity.
     */
    static calculateReciprocity(graph, edgeCount, density) {
        let totalWeight = 0;
        let sumMinWeights = 0;
        let reciprocatedEdges = 0;

        graph.forEachLink((link) => {
            totalWeight += link.data.weight;
            const reverseLink = graph.getLink(link.toId, link.fromId);
            if (reverseLink) {
                reciprocatedEdges++;
                sumMinWeights += Math.min(
                    link.data.weight,
                    reverseLink.data.weight,
                );
            }
        });

        const binaryReciprocity =
            edgeCount > 0 ? reciprocatedEdges / edgeCount : 0;
        const weightedReciprocity =
            totalWeight > 0 ? sumMinWeights / totalWeight : 0;
        const reciprocityRho =
            1 - density > 0 ? (binaryReciprocity - density) / (1 - density) : 0;

        return {
            reciprocity: weightedReciprocity.toFixed(4),
            binaryReciprocity: binaryReciprocity.toFixed(4),
            reciprocityRho: reciprocityRho.toFixed(4),
        };
    }

    /**
     * Calculates Mean Node Entropy.
     */
    static calculateEntropy(graph, n) {
        const nodeStats = new Map();

        graph.forEachLink((link) => {
            let stats = nodeStats.get(link.fromId);
            if (!stats) {
                stats = { weight: 0, weights: [] };
                nodeStats.set(link.fromId, stats);
            }
            stats.weight += link.data.weight;
            stats.weights.push(link.data.weight);
        });

        let totalEntropy = 0;
        for (const stats of nodeStats.values()) {
            let nodeEntropy = 0;
            for (let i = 0; i < stats.weights.length; i++) {
                const w = stats.weights[i];
                const p = w / stats.weight;
                if (p > 0) {
                    nodeEntropy -= p * Math.log2(p);
                }
            }
            totalEntropy += nodeEntropy;
        }

        return n > 0 ? (totalEntropy / n).toFixed(4) : '0.0000';
    }

    /**
     * Calculates Global (unweighted) and Weighted Efficiency.
     */
    static calculateEfficiency(graph, n) {
        const efficiencySums = { unweighted: 0, weighted: 0 };
        const nodes = this._getNodeIds(graph);
        const adj = this._getAdjacencyList(graph);

        for (let i = 0; i < nodes.length; i++) {
            const startNode = nodes[i];
            const uDistances = this.bfsDistances(adj, startNode);
            const wDistances = this.dijkstraDistances(adj, startNode);

            this._sumEfficiencyForNode(uDistances, wDistances, efficiencySums);
        }

        const norm = n > 1 ? n * (n - 1) : 1;
        const unweightedEfficiency =
            n > 1 ? efficiencySums.unweighted / norm : 0;
        const weightedEfficiency = n > 1 ? efficiencySums.weighted / norm : 0;

        return {
            efficiency: unweightedEfficiency.toFixed(4),
            weightedEfficiency: weightedEfficiency.toFixed(4),
        };
    }

    static _getNodeIds(graph) {
        const nodes = [];
        graph.forEachNode((node) => {
            nodes.push(node.id);
        });
        return nodes;
    }

    static _getAdjacencyList(graph) {
        const adj = new Map();
        graph.forEachLink((link) => {
            let list = adj.get(link.fromId);
            if (!list) {
                list = [];
                adj.set(link.fromId, list);
            }
            list.push({ to: link.toId, weight: link.data.weight });
        });
        return adj;
    }

    static _sumEfficiencyForNode(uDistances, wDistances, efficiencySums) {
        for (const ud of uDistances.values()) {
            if (ud > 0) efficiencySums.unweighted += 1 / ud;
        }
        for (const wd of wDistances.values()) {
            if (wd > 0) efficiencySums.weighted += 1 / wd;
        }
    }

    /**
     * Calculates 12D scale-interval embedding (pitch class interval signature).
     */
    static calculateEmbedding(graph) {
        const intervalVector = new Array(12).fill(0);

        graph.forEachLink((link) => {
            const interval = Utils.getInterval(link.fromId, link.toId);
            intervalVector[interval] += link.data.weight;
        });

        const sumSq = intervalVector.reduce((a, b) => a + b * b, 0);
        const denom = Math.sqrt(sumSq);
        return denom > 0
            ? intervalVector.map((v) => (v / denom).toFixed(4))
            : intervalVector.map(() => '0.0000');
    }

    /**
     * Aggregates all metrics for the given graph.
     */
    static calculateAll(graph, edgeCount) {
        const n = graph.getNodesCount();
        const density = n > 1 ? edgeCount / (n * (n - 1)) : 0;

        const reciprocityMetrics = this.calculateReciprocity(
            graph,
            edgeCount,
            density,
        );
        const entropy = this.calculateEntropy(graph, n);
        const efficiencyMetrics = this.calculateEfficiency(graph, n);
        const embedding = this.calculateEmbedding(graph);

        return {
            vertices: n,
            edges: edgeCount,
            density: density.toFixed(4),
            ...reciprocityMetrics,
            entropy,
            ...efficiencyMetrics,
            embedding,
        };
    }

    /**
     * Helper for Breadth-First Search distances (Unweighted)
     */
    static bfsDistances(adj, startNodeId) {
        const distances = new Map();
        distances.set(startNodeId, 0);
        const queue = [startNodeId];
        let head = 0;

        while (head < queue.length) {
            const u = queue[head++];
            const neighbors = adj.get(u);
            if (!neighbors) continue;

            const uDist = distances.get(u);

            for (let i = 0; i < neighbors.length; i++) {
                const v = neighbors[i].to;
                if (!distances.has(v)) {
                    distances.set(v, uDist + 1);
                    queue.push(v);
                }
            }
        }
        return distances;
    }

    /**
     * Helper for Dijkstra's distances (Weighted)
     */
    static dijkstraDistances(adj, startNodeId) {
        const distances = new Map();
        const visited = new Set();
        const pq = new MinHeap();

        distances.set(startNodeId, 0);
        pq.push([startNodeId, 0]);

        while (pq.length > 0) {
            const [u, d] = pq.pop();

            if (visited.has(u)) continue;
            visited.add(u);

            const neighbors = adj.get(u);
            if (!neighbors) continue;

            for (let i = 0; i < neighbors.length; i++) {
                const v = neighbors[i].to;
                const weight = neighbors[i].weight || 1;
                const alt = d + 1 / weight;

                const vDist = distances.get(v);
                if (vDist === undefined || alt < vDist) {
                    distances.set(v, alt);
                    pq.push([v, alt]);
                }
            }
        }
        return distances;
    }
}
