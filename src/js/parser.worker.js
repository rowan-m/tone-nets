import { NetworkParser } from './NetworkParser.js';

self.onmessage = async (e) => {
    const { midiBuffer } = e.data;
    try {
        const { graph, summary } =
            await NetworkParser.buildMidiNetwork(midiBuffer);

        // Serialize the graph for transfer
        const serializedGraph = {
            nodes: [],
            links: [],
        };

        graph.forEachNode((node) => {
            serializedGraph.nodes.push({ id: node.id, data: node.data });
        });

        graph.forEachLink((link) => {
            serializedGraph.links.push({
                fromId: link.fromId,
                toId: link.toId,
                data: link.data,
            });
        });

        self.postMessage({ summary, serializedGraph });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
