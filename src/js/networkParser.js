import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';

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
    let edgeCount = 0;

    // Extract Metadata
    const title = midi.name || 'Unknown Title';

    // We process each track separately to avoid creating transitions
    // between notes played on different instruments/channels.
    midi.tracks.forEach(track => {
        // Filter out drum/percussion channel (MIDI channel 10 is index 9)
        if (track.channel === 9) return;

        // Group notes by start time to handle chords (notes played simultaneously)
        const notesByTime = new Map();
        
        track.notes.forEach(note => {
            // Group by exact MIDI ticks (like the original R code does with time)
            const timeKey = note.ticks;
            
            if (!notesByTime.has(timeKey)) {
                notesByTime.set(timeKey, []);
            }
            notesByTime.get(timeKey).push(note.name); // e.g., "C4", "G#3"
        });

        // Sort the distinct times chronologically
        const sortedTimes = Array.from(notesByTime.keys()).sort((a, b) => a - b);

        // Build transitions: from all notes at time T to all notes at time T+1
        for (let i = 1; i < sortedTimes.length; i++) {
            const previousTime = sortedTimes[i - 1];
            const currentTime = sortedTimes[i];

            const sourceNotes = notesByTime.get(previousTime);
            const targetNotes = notesByTime.get(currentTime);

            sourceNotes.forEach(source => {
                graph.addNode(source, { name: source });
                
                targetNotes.forEach(target => {
                    // Scientific Parity: Skip self-loops (w_xx = 0) as per paper section "Network construction"
                    if (source === target) return;

                    graph.addNode(target, { name: target });
                    
                    const linkId = `${source}->${target}`;
                    const existingLink = graph.getLink(source, target);
                    
                    if (existingLink) {
                        existingLink.data.weight += 1;
                    } else {
                        graph.addLink(source, target, { weight: 1, id: linkId });
                        edgeCount++;
                    }
                });
            });
        }
    });

    // Compute degree (in + out) for each node for visualization sizing
    graph.forEachNode((node) => {
        let degree = 0;
        graph.forEachLinkedNode(node.id, () => {
            degree += 1;
        });
        node.data.degree = degree;
    });

    // --- Scientific Metric Calculations (from the paper) ---
    
    // 1. Density (d)
    const n = graph.getNodesCount();
    const density = n > 1 ? edgeCount / (n * (n - 1)) : 0;

    // 2. Reciprocity (r and rho)
    // - Weighted Reciprocity (r): W_recip / W_total
    // - Normalized Reciprocity (rho): (r - density) / (1 - density)
    let totalWeight = 0;
    let reciprocatedWeight = 0;
    graph.forEachLink(link => {
        totalWeight += link.data.weight;
        const reverseLink = graph.getLink(link.toId, link.fromId);
        if (reverseLink) {
            reciprocatedWeight += link.data.weight;
        }
    });
    const weightedReciprocity = totalWeight > 0 ? (reciprocatedWeight / totalWeight) : 0;
    const reciprocityRho = (1 - density) > 0 ? (weightedReciprocity - density) / (1 - density) : 0;

    // 3. Mean Node Entropy (H)
    let totalEntropy = 0;
    graph.forEachNode(node => {
        let nodeOutWeight = 0;
        const outEdges = [];
        graph.forEachLinkedNode(node.id, (linkedNode, link) => {
            if (link.fromId === node.id) {
                nodeOutWeight += link.data.weight;
                outEdges.push(link.data.weight);
            }
        });

        if (nodeOutWeight > 0 && outEdges.length > 1) {
            let nodeEntropy = 0;
            outEdges.forEach(w => {
                const p = w / nodeOutWeight;
                nodeEntropy -= p * Math.log2(p);
            });
            // Normalize by max possible entropy log2(out-degree)
            const maxH = Math.log2(outEdges.length);
            totalEntropy += (nodeEntropy / maxH);
        } else if (outEdges.length === 1) {
            // Entropy is 0 if only one transition exists
            totalEntropy += 0;
        }
    });
    const meanNodeEntropy = totalEntropy / n;

    // 4. Global Efficiency (E)
    // We calculate both unweighted and weighted versions.
    // Weighted distance uses edge weight as "cost" (repetition reduces efficiency).
    let unweightedEfficiencySum = 0;
    let weightedEfficiencySum = 0;
    const nodes = [];
    graph.forEachNode(node => { 
        nodes.push(node.id); 
    });
    
    for (let i = 0; i < nodes.length; i++) {
        const uDistances = bfsDistances(graph, nodes[i]);
        const wDistances = dijkstraDistances(graph, nodes[i]);
        
        for (let j = 0; j < nodes.length; j++) {
            if (i === j) continue;
            
            const ud = uDistances[nodes[j]];
            if (ud && ud > 0) unweightedEfficiencySum += (1 / ud);
            
            const wd = wDistances[nodes[j]];
            if (wd && wd > 0) weightedEfficiencySum += (1 / wd);
        }
    }
    
    const unweightedEfficiency = n > 1 ? unweightedEfficiencySum / (n * (n - 1)) : 0;
    const weightedEfficiency = n > 1 ? weightedEfficiencySum / (n * (n - 1)) : 0;

    // 5. Scale-interval Embedding (Interval Signature)
    // We calculate a 12D vector representing the distribution of interval classes (0-11 semitones)
    const intervalVector = new Array(12).fill(0);
    const noteToSemitone = (note) => {
        const notes = { 'C':0, 'C#':1, 'D':2, 'D#':3, 'E':4, 'F':5, 'F#':6, 'G':7, 'G#':8, 'A':9, 'A#':10, 'B':11 };
        const match = note.toUpperCase().match(/([A-G]#?B?)(-?\d+)?/);
        if (!match) return 0;
        const pc = match[1].replace('B', 'b'); // Handle flats if any
        // Simple mapping for flats
        const pcMap = { 'CB':11, 'DB':1, 'EB':3, 'FB':4, 'GB':6, 'AB':8, 'BB':10 };
        const val = notes[match[1]] !== undefined ? notes[match[1]] : pcMap[match[1]];
        const oct = match[2] ? parseInt(match[2]) : 4;
        return (oct * 12) + (val || 0);
    };

    graph.forEachLink(link => {
        const s = noteToSemitone(link.fromId);
        const t = noteToSemitone(link.toId);
        // Interval Class: absolute difference modulo 12
        const interval = Math.abs(t - s) % 12;
        intervalVector[interval] += link.data.weight;
    });

    // Normalize the vector (L2 Normalization to match R implementation)
    const sumSq = intervalVector.reduce((a, b) => a + (b * b), 0);
    const denom = Math.sqrt(sumSq);
    const normalizedEmbedding = denom > 0 
        ? intervalVector.map(v => (v / denom).toFixed(4))
        : intervalVector.map(v => "0.0000");

    return {
        graph,
        summary: {
            title: title,
            vertices: n,
            edges: edgeCount,
            density: density.toFixed(4),
            reciprocity: weightedReciprocity.toFixed(4),
            reciprocityRho: reciprocityRho.toFixed(4),
            entropy: meanNodeEntropy.toFixed(4),
            efficiency: unweightedEfficiency.toFixed(4),
            weightedEfficiency: weightedEfficiency.toFixed(4),
            embedding: normalizedEmbedding
        }
    };
}

/**
 * Rebuilds an ngraph.graph from serialized data
 * @param {Object} serializedGraph 
 * @returns {Object} ngraph.graph
 */
export function rebuildGraph(serializedGraph) {
    const graph = createGraph();
    serializedGraph.nodes.forEach(node => {
        graph.addNode(node.id, node.data);
    });
    serializedGraph.links.forEach(link => {
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
    
    while (queue.length > 0) {
        const u = queue.shift();
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

/**
 * Helper for Dijkstra's distances (Weighted)
 * Uses edge weights as cost.
 */
function dijkstraDistances(graph, startNodeId) {
    const distances = {};
    const visited = new Set();
    const pq = [[startNodeId, 0]]; // [nodeId, distance]

    distances[startNodeId] = 0;

    while (pq.length > 0) {
        // Simple priority queue (sort by distance)
        pq.sort((a, b) => a[1] - b[1]);
        const [u, d] = pq.shift();

        if (visited.has(u)) continue;
        visited.add(u);

        graph.forEachLinkedNode(u, (linkedNode, link) => {
            if (link.fromId !== u) return; // Only outgoing edges
            const v = linkedNode.id;
            const weight = link.data.weight || 1;
            const alt = d + weight;

            if (distances[v] === undefined || alt < distances[v]) {
                distances[v] = alt;
                pq.push([v, alt]);
            }
        });
    }
    return distances;
}
