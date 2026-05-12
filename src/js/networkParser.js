import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { getInterval } from './utils.js';

function calculateReciprocity(graph, edgeCount, density) {
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

    const binaryReciprocity = edgeCount > 0 ? reciprocatedEdges / edgeCount : 0;
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

function calculateEntropy(graph, n) {
    let totalEntropy = 0;
    graph.forEachNode((node) => {
        let nodeOutWeight = 0;
        const outWeights = [];
        graph.forEachLinkedNode(node.id, (linkedNode, link) => {
            if (link.fromId === node.id) {
                nodeOutWeight += link.data.weight;
                outWeights.push(link.data.weight);
            }
        });

        if (nodeOutWeight > 0) {
            let nodeEntropy = 0;
            outWeights.forEach((w) => {
                const p = w / nodeOutWeight;
                if (p > 0) {
                    nodeEntropy -= p * Math.log2(p);
                }
            });
            totalEntropy += nodeEntropy;
        }
    });
    return (totalEntropy / n).toFixed(4);
}

function _sumEfficiencyForNode(
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

function calculateEfficiency(graph, n) {
    const efficiencySums = { unweighted: 0, weighted: 0 };
    const nodes = [];
    graph.forEachNode((node) => {
        nodes.push(node.id);
    });

    for (let i = 0; i < nodes.length; i++) {
        const startNode = nodes[i];
        const uDistances = bfsDistances(graph, startNode);
        const wDistances = dijkstraDistances(graph, startNode);

        _sumEfficiencyForNode(nodes, i, uDistances, wDistances, efficiencySums);
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

function calculateEmbedding(graph) {
    const intervalVector = new Array(12).fill(0);

    graph.forEachLink((link) => {
        const interval = getInterval(link.fromId, link.toId);
        intervalVector[interval] += link.data.weight;
    });

    const sumSq = intervalVector.reduce((a, b) => a + b * b, 0);
    const denom = Math.sqrt(sumSq);
    return denom > 0
        ? intervalVector.map((v) => (v / denom).toFixed(4))
        : intervalVector.map(() => '0.0000');
}

function calculateMetrics(graph, edgeCount) {
    const n = graph.getNodesCount();
    const density = n > 1 ? edgeCount / (n * (n - 1)) : 0;

    const reciprocityMetrics = calculateReciprocity(graph, edgeCount, density);
    const entropy = calculateEntropy(graph, n);
    const efficiencyMetrics = calculateEfficiency(graph, n);
    const embedding = calculateEmbedding(graph);

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

function extractMetadata(midi) {
    let title = midi.name ? midi.name.trim() : '';

    if (midi.header && midi.header.meta) {
        // Find the first meaningful text event (often the artist or a subtitle)
        const firstTextEvent = midi.header.meta.find(
            (m) =>
                (m.type === 'text' || m.type === 'trackName') &&
                m.text &&
                m.text.trim().length > 0 &&
                !m.text.trim().match(/^Track \d+$/i) &&
                m.text.trim() !== title,
        );

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

function processTransitions(midi, graph) {
    let edgeCount = 0;

    // We process each track separately to avoid creating transitions
    // between notes played on different instruments/channels.
    midi.tracks.forEach((track) => {
        // Filter out drum/percussion channel (MIDI channel 10 is index 9)
        if (track.channel === 9) return;

        // Group notes by start time to handle chords (notes played simultaneously)
        const notesByTime = new Map();

        track.notes.forEach((note) => {
            // Group by exact MIDI ticks (like the original R code does with time)
            const timeKey = note.ticks;

            if (!notesByTime.has(timeKey)) {
                notesByTime.set(timeKey, []);
            }
            notesByTime.get(timeKey).push(note.name); // e.g., "C4", "G#3"
        });

        // Sort the distinct times chronologically
        const sortedTimes = Array.from(notesByTime.keys()).sort(
            (a, b) => a - b,
        );

        // Build transitions: from all notes at time T to all notes at time T+1
        for (let i = 1; i < sortedTimes.length; i++) {
            const previousTime = sortedTimes[i - 1];
            const currentTime = sortedTimes[i];

            const sourceNotes = notesByTime.get(previousTime);
            const targetNotes = notesByTime.get(currentTime);

            sourceNotes.forEach((source) => {
                graph.addNode(source, { name: source });

                targetNotes.forEach((target) => {
                    // Scientific Parity: Skip self-loops (w_xx = 0) as per paper section "Network construction"
                    if (source === target) return;

                    graph.addNode(target, { name: target });

                    const linkId = `${source}->${target}`;
                    const existingLink = graph.getLink(source, target);

                    if (existingLink) {
                        existingLink.data.weight += 1;
                    } else {
                        graph.addLink(source, target, {
                            weight: 1,
                            id: linkId,
                        });
                        edgeCount++;
                    }
                });
            });
        }
    });

    return edgeCount;
}

function computeNodeDegrees(graph) {
    // Compute degree (in + out) for each node for visualization sizing
    graph.forEachNode((node) => {
        let degree = 0;
        graph.forEachLinkedNode(node.id, () => {
            degree += 1;
        });
        node.data.degree = degree;
    });
}

/**
 * Parses a MIDI file buffer and constructs a directed graph
 * representing note-to-note transitions.
 *
 * @param {ArrayBuffer} midiBuffer
 * @returns {Object} Graph object and summary statistics
 */
export async function buildMidiNetwork(midiBuffer) {
    const midi = new Midi(midiBuffer);
    const graph = createGraph();

    const title = extractMetadata(midi);
    const edgeCount = processTransitions(midi, graph);
    computeNodeDegrees(graph);

    const metrics = calculateMetrics(graph, edgeCount);

    return {
        graph,
        summary: {
            title: title,
            ...metrics,
        },
    };
}

/**
 * Rebuilds an ngraph.graph from serialized data
 * @param {Object} serializedGraph
 * @returns {Object} ngraph.graph
 */
export function rebuildGraph(serializedGraph) {
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
function bfsDistances(graph, startNodeId) {
    const distances = {};
    distances[startNodeId] = 0;
    const queue = [startNodeId];
    let head = 0;

    while (head < queue.length) {
        const u = queue[head++];
        graph.forEachLinkedNode(u, (linkedNode, link) => {
            const v = linkedNode.id;
            if (link.fromId === u && distances[v] === undefined) {
                distances[v] = distances[u] + 1;
                queue.push(v);
            }
        });
    }
    return distances;
}

class MinHeap {
    constructor() {
        this.data = [];
    }
    push(val) {
        this.data.push(val);
        let idx = this.data.length - 1;
        while (idx > 0) {
            let p = (idx - 1) >> 1;
            if (this.data[p][1] <= this.data[idx][1]) break;
            const t = this.data[p];
            this.data[p] = this.data[idx];
            this.data[idx] = t;
            idx = p;
        }
    }
    pop() {
        if (this.data.length === 1) return this.data.pop();
        const top = this.data[0];
        this.data[0] = this.data.pop();
        let idx = 0;
        const len = this.data.length;
        while (true) {
            let left = (idx << 1) + 1,
                right = left + 1,
                min = idx;
            if (left < len && this.data[left][1] < this.data[min][1])
                min = left;
            if (right < len && this.data[right][1] < this.data[min][1])
                min = right;
            if (min === idx) break;
            const t = this.data[idx];
            this.data[idx] = this.data[min];
            this.data[min] = t;
            idx = min;
        }
        return top;
    }
    get length() {
        return this.data.length;
    }
}

/**
 * Helper for Dijkstra's distances (Weighted)
 * Uses edge weights as cost.
 */
function dijkstraDistances(graph, startNodeId) {
    const distances = {};
    const visited = new Set();
    const pq = new MinHeap(); // MinHeap of [nodeId, distance]

    distances[startNodeId] = 0;
    pq.push([startNodeId, 0]);

    while (pq.length > 0) {
        const [u, d] = pq.pop();

        if (visited.has(u)) continue;
        visited.add(u);

        graph.forEachLinkedNode(u, (linkedNode, link) => {
            if (link.fromId !== u) return; // Only outgoing edges
            const v = linkedNode.id;
            const weight = link.data.weight || 1;
            const alt = d + 1 / weight;

            if (distances[v] === undefined || alt < distances[v]) {
                distances[v] = alt;
                pq.push([v, alt]);
            }
        });
    }
    return distances;
}
