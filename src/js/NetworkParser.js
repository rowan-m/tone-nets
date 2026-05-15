import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { Utils } from './Utils.js';
import { MinHeap } from './MinHeap.js';

export class NetworkParser {
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

    static calculateEntropy(graph, n) {
        const nodeStats = new Map();

        // Optimize: Iterate all links once instead of nested forEachNode + forEachLinkedNode
        // to reduce ngraph.graph API allocation overhead
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
        nodeStats.forEach((stats) => {
            let nodeEntropy = 0;
            stats.weights.forEach((w) => {
                const p = w / stats.weight;
                if (p > 0) {
                    nodeEntropy -= p * Math.log2(p);
                }
            });
            totalEntropy += nodeEntropy;
        });

        return n > 0 ? (totalEntropy / n).toFixed(4) : '0.0000';
    }

    static _sumEfficiencyForNode(
        nodes,
        i,
        uDistances,
        wDistances,
        efficiencySums,
    ) {
        for (let j = 0; j < nodes.length; j++) {
            if (i === j) continue;

            const targetNode = nodes[j];

            const ud = uDistances[targetNode];
            if (ud !== undefined && ud > 0) efficiencySums.unweighted += 1 / ud;

            const wd = wDistances[targetNode];
            if (wd !== undefined && wd > 0) efficiencySums.weighted += 1 / wd;
        }
    }

    static calculateEfficiency(graph, n) {
        const efficiencySums = { unweighted: 0, weighted: 0 };
        const nodes = [];
        graph.forEachNode((node) => {
            nodes.push(node.id);
        });

        // Optimize: Precompute adjacency list for O(1) neighbor lookups
        // to avoid expensive ngraph.graph.forEachLinkedNode calls inside V^2 loops
        const adj = new Map();
        graph.forEachLink((link) => {
            let list = adj.get(link.fromId);
            if (!list) {
                list = [];
                adj.set(link.fromId, list);
            }
            list.push({ to: link.toId, weight: link.data.weight });
        });

        for (let i = 0; i < nodes.length; i++) {
            const startNode = nodes[i];
            const uDistances = this.bfsDistances(adj, startNode);
            const wDistances = this.dijkstraDistances(adj, startNode);

            this._sumEfficiencyForNode(
                nodes,
                i,
                uDistances,
                wDistances,
                efficiencySums,
            );
        }

        const unweightedEfficiency =
            n > 1 ? efficiencySums.unweighted / (n * (n - 1)) : 0;
        const weightedEfficiency =
            n > 1 ? efficiencySums.weighted / (n * (n - 1)) : 0;

        return {
            efficiency: unweightedEfficiency.toFixed(4),
            weightedEfficiency: weightedEfficiency.toFixed(4),
        };
    }

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

    static calculateMetrics(graph, edgeCount) {
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

    static extractMetadata(midi) {
        let title = midi.name ? midi.name.trim() : '';

        if (midi.header && midi.header.meta) {
            // Find the first meaningful text event (often the artist or a subtitle)
            const firstTextEvent = midi.header.meta.find((m) => {
                if ((m.type === 'text' || m.type === 'trackName') && m.text) {
                    const trimmedText = m.text.trim();
                    return (
                        trimmedText.length > 0 &&
                        !/^Track \d+$/i.test(trimmedText) &&
                        trimmedText !== title
                    );
                }
                return false;
            });

            if (firstTextEvent) {
                const extraInfo = firstTextEvent.text.trim();
                if (title) {
                    // If we have both, combine them (e.g., "Song Name - Artist")
                    title = `${title} - ${extraInfo}`;
                } else {
                    title = extraInfo;
                }
            }
        }
        return title;
    }

    static processTransitions(midi, graph) {
        let edgeCount = 0;

        // We process each track separately to avoid creating transitions
        // between notes played on different instruments/channels.
        for (let t = 0; t < midi.tracks.length; t++) {
            const track = midi.tracks[t];
            // Filter out drum/percussion channel (MIDI channel 10 is index 9)
            if (track.channel === 9) continue;

            const notesByTime = this._groupNotesByTime(track.notes);
            const sortedTimes = Array.from(notesByTime.keys()).sort(
                (a, b) => a - b,
            );

            // Build transitions: from all notes at time T to all notes at time T+1
            for (let i = 1; i < sortedTimes.length; i++) {
                const sourceNotes = notesByTime.get(sortedTimes[i - 1]);
                const targetNotes = notesByTime.get(sortedTimes[i]);

                edgeCount += this._buildTransitionsForTimeStep(
                    graph,
                    sourceNotes,
                    targetNotes,
                );
            }
        }

        return edgeCount;
    }

    static _groupNotesByTime(trackNotes) {
        const notesByTime = new Map();
        for (let n = 0; n < trackNotes.length; n++) {
            const note = trackNotes[n];
            const timeKey = note.ticks;
            const name = note.name;

            let group = notesByTime.get(timeKey);
            if (!group) {
                group = [];
                notesByTime.set(timeKey, group);
            }
            group.push(name);
        }
        return notesByTime;
    }

    static _buildTransitionsForTimeStep(graph, sourceNotes, targetNotes) {
        let edgesAdded = 0;
        for (let s = 0; s < sourceNotes.length; s++) {
            const source = sourceNotes[s];

            if (!graph.getNode(source)) {
                graph.addNode(source, { name: source });
            }

            for (let tr = 0; tr < targetNotes.length; tr++) {
                const target = targetNotes[tr];
                // Scientific Parity: Skip self-loops (w_xx = 0) as per paper section "Network construction"
                if (source === target) continue;

                if (!graph.getNode(target)) {
                    graph.addNode(target, { name: target });
                }

                const existingLink = graph.getLink(source, target);

                if (existingLink) {
                    existingLink.data.weight += 1;
                } else {
                    graph.addLink(source, target, {
                        weight: 1,
                        id: `${source}->${target}`,
                    });
                    edgesAdded++;
                }
            }
        }
        return edgesAdded;
    }

    static computeNodeDegrees(graph) {
        // Compute degree (in + out) for each node for visualization sizing
        const nodeDataMap = new Map();
        graph.forEachNode((node) => {
            node.data.degree = 0;
            nodeDataMap.set(node.id, node.data);
        });

        graph.forEachLink((link) => {
            const fromData = nodeDataMap.get(link.fromId);
            if (fromData) fromData.degree += 1;

            // Only increment for toNode if it's different to avoid double-counting self-loops
            if (link.toId !== link.fromId) {
                const toData = nodeDataMap.get(link.toId);
                if (toData) toData.degree += 1;
            }
        });
    }

    /**
     * Parses a MIDI file buffer and constructs a directed graph
     * representing note-to-note transitions.
     *
     * @param {ArrayBuffer} midiBuffer
     * @returns {Object} Graph object and summary statistics
     */
    static async buildMidiNetwork(midiBuffer) {
        const midi = new Midi(midiBuffer);
        const graph = createGraph();

        const title = this.extractMetadata(midi);
        const edgeCount = this.processTransitions(midi, graph);
        this.computeNodeDegrees(graph);

        const metrics = this.calculateMetrics(graph, edgeCount);

        return {
            graph,
            summary: {
                title: title,
                duration: midi.duration,
                ...metrics,
            },
        };
    }

    /**
     * Rebuilds an ngraph.graph from serialized data
     * @param {Object} serializedGraph
     * @returns {Object} ngraph.graph
     */
    static rebuildGraph(serializedGraph) {
        const graph = createGraph();
        serializedGraph.nodes.forEach((node) => {
            graph.addNode(node.id, node.data);
        });
        serializedGraph.links.forEach((link) => {
            graph.addLink(link.fromId, link.toId, link.data);
        });
        return graph;
    }

    /**
     * Helper for Breadth-First Search distances (Unweighted)
     */
    static bfsDistances(adj, startNodeId) {
        const distances = {};
        distances[startNodeId] = 0;
        const queue = [startNodeId];
        let head = 0;

        while (head < queue.length) {
            const u = queue[head++];
            const neighbors = adj.get(u);
            if (!neighbors) continue;

            for (let i = 0; i < neighbors.length; i++) {
                const v = neighbors[i].to;
                if (distances[v] === undefined) {
                    distances[v] = distances[u] + 1;
                    queue.push(v);
                }
            }
        }
        return distances;
    }

    /**
     * Helper for Dijkstra's distances (Weighted)
     * Uses edge weights as cost.
     */
    static dijkstraDistances(adj, startNodeId) {
        const distances = {};
        const visited = new Set();
        const pq = new MinHeap(); // MinHeap of [nodeId, distance]

        distances[startNodeId] = 0;
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

                if (distances[v] === undefined || alt < distances[v]) {
                    distances[v] = alt;
                    pq.push([v, alt]);
                }
            }
        }
        return distances;
    }
}
