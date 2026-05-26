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
        let unweightedSum = 0;
        let weightedSum = 0;

        const nodeToIndex = new Map();
        let idx = 0;
        graph.forEachNode((node) => {
            nodeToIndex.set(node.id, idx++);
        });

        const numNodes = nodeToIndex.size;

        const adj = Array.from({ length: numNodes });
        for (let i = 0; i < numNodes; i++) {
            adj[i] = [];
        }
        graph.forEachLink((link) => {
            const fromIdx = nodeToIndex.get(link.fromId);
            const toIdx = nodeToIndex.get(link.toId);
            adj[fromIdx].push({
                to: toIdx,
                weight: link.data.weight,
            });
        });

        const uDistances = new Float64Array(numNodes);
        const wDistances = new Float64Array(numNodes);
        const visited = new Uint8Array(numNodes);
        const queue = new Int32Array(numNodes);
        const pq = new MinHeap();

        for (let i = 0; i < numNodes; i++) {
            unweightedSum += this._bfsEfficiency(i, adj, uDistances, queue);
            weightedSum += this._dijkstraEfficiency(
                i,
                adj,
                wDistances,
                visited,
                pq,
            );
        }

        const norm = n > 1 ? n * (n - 1) : 1;
        const unweightedEfficiency = n > 1 ? unweightedSum / norm : 0;
        const weightedEfficiency = n > 1 ? weightedSum / norm : 0;

        return {
            efficiency: unweightedEfficiency.toFixed(4),
            weightedEfficiency: weightedEfficiency.toFixed(4),
        };
    }

    static _bfsEfficiency(startNode, adj, uDistances, queue) {
        let unweightedSum = 0;
        uDistances.fill(-1);
        uDistances[startNode] = 0;
        queue[0] = startNode;
        let head = 0;
        let tail = 1;

        while (head < tail) {
            const u = queue[head++];
            const neighbors = adj[u];
            const uDist = uDistances[u];

            for (let j = 0; j < neighbors.length; j++) {
                const v = neighbors[j].to;
                if (uDistances[v] === -1) {
                    const newDist = uDist + 1;
                    uDistances[v] = newDist;
                    queue[tail++] = v;
                    unweightedSum += 1 / newDist;
                }
            }
        }
        return unweightedSum;
    }

    static _dijkstraEfficiency(startNode, adj, wDistances, visited, pq) {
        let weightedSum = 0;
        wDistances.fill(-1);
        visited.fill(0);

        pq.data.length = 0;
        pq.priorities.length = 0;

        wDistances[startNode] = 0;
        pq.push([startNode, 0]);

        while (pq.length > 0) {
            const [u, d] = pq.pop();

            if (visited[u]) continue;
            visited[u] = 1;

            if (d > 0) weightedSum += 1 / d;

            const neighbors = adj[u];

            for (let j = 0; j < neighbors.length; j++) {
                const v = neighbors[j].to;
                if (visited[v]) continue;

                const weight = neighbors[j].weight || 1;
                const alt = d + 1 / weight;

                const vDist = wDistances[v];
                if (vDist === -1 || alt < vDist) {
                    wDistances[v] = alt;
                    pq.push([v, alt]);
                }
            }
        }
        return weightedSum;
    }

    /**
     * Calculates 12D scale-interval embedding (pitch class interval signature).
     */
    static calculateEmbedding(graph) {
        const intervalVector = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

        graph.forEachLink((link) => {
            const interval = Utils.getInterval(link.fromId, link.toId);
            intervalVector[interval] += link.data.weight;
        });

        let sumSq = 0;
        for (let i = 0; i < intervalVector.length; i++) {
            const val = intervalVector[i];
            sumSq += val * val;
        }

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
}
