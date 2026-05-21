import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { NetworkMetrics } from './NetworkMetrics.js';

export class NetworkParser {
    static calculateMetrics(graph, edgeCount) {
        return NetworkMetrics.calculateAll(graph, edgeCount);
    }

    static extractMetadata(midi) {
        let title = midi.name ? midi.name.trim() : '';

        if (midi.header && midi.header.meta) {
            const firstTextEvent = midi.header.meta.find((m) =>
                this._isMeaningfulTextEvent(m, title),
            );

            if (firstTextEvent) {
                const extraInfo = firstTextEvent.text.trim();
                title = title ? `${title} - ${extraInfo}` : extraInfo;
            }
        }
        return title;
    }

    static _isMeaningfulTextEvent(event, currentTitle) {
        if (
            (event.type === 'text' || event.type === 'trackName') &&
            event.text
        ) {
            const trimmedText = event.text.trim();
            return (
                trimmedText.length > 0 &&
                !/^Track \d+$/i.test(trimmedText) &&
                trimmedText !== currentTitle
            );
        }
        return false;
    }

    static processTransitions(midi, graph) {
        let edgeCount = 0;

        // We process each track separately to avoid creating transitions
        // between notes played on different instruments/channels.
        for (let t = 0; t < midi.tracks.length; t++) {
            const track = midi.tracks[t];
            // Filter out drum/percussion channel (MIDI channel 10 is index 9)
            if (track.channel === 9) continue;

            edgeCount += this._processTrackTransitions(graph, track);
        }

        return edgeCount;
    }

    static _processTrackTransitions(graph, track) {
        let trackEdgeCount = 0;
        const notesByTime = this._groupNotesByTime(track.notes);
        const sortedTimes = Array.from(notesByTime.keys()).sort(
            (a, b) => a - b,
        );

        // Build transitions: from all notes at time T to all notes at time T+1
        for (let i = 1; i < sortedTimes.length; i++) {
            const sourceNotes = notesByTime.get(sortedTimes[i - 1]);
            const targetNotes = notesByTime.get(sortedTimes[i]);

            trackEdgeCount += this._buildTransitionsForTimeStep(
                graph,
                sourceNotes,
                targetNotes,
            );
        }
        return trackEdgeCount;
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

        this.ensureNodesExist(graph, sourceNotes);
        this.ensureNodesExist(graph, targetNotes);

        for (let s = 0; s < sourceNotes.length; s++) {
            const source = sourceNotes[s];

            for (let tr = 0; tr < targetNotes.length; tr++) {
                const target = targetNotes[tr];
                if (source === target) continue;

                if (this.updateOrCreateLink(graph, source, target)) {
                    edgesAdded++;
                }
            }
        }
        return edgesAdded;
    }

    static addTransition(graph, source, target) {
        if (!source || !target || source === target) return false;

        this.ensureNodesExist(graph, [source, target]);
        return this.updateOrCreateLink(graph, source, target);
    }

    static ensureNodesExist(graph, nodeIds) {
        let needsUpdate = false;
        for (let i = 0; i < nodeIds.length; i++) {
            const id = nodeIds[i];
            if (!graph.hasNode(id)) {
                if (!needsUpdate) {
                    graph.beginUpdate();
                    needsUpdate = true;
                }
                graph.addNode(id, { name: id });
            }
        }
        if (needsUpdate) {
            graph.endUpdate();
        }
    }

    static updateOrCreateLink(graph, source, target) {
        const existingLink = graph.getLink(source, target);

        if (existingLink) {
            existingLink.data.weight += 1;
            return false;
        }

        graph.addLink(source, target, {
            weight: 1,
            id: `${source}->${target}`,
        });
        return true;
    }

    static computeNodeDegrees(graph) {
        // Compute degree (in + out) for each node for visualization sizing
        const nodeDataMap = new Map();
        graph.forEachNode((node) => {
            if (!node.data) node.data = {};
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
        for (let i = 0; i < serializedGraph.nodes.length; i++) {
            const node = serializedGraph.nodes[i];
            graph.addNode(node.id, node.data);
        }
        for (let i = 0; i < serializedGraph.links.length; i++) {
            const link = serializedGraph.links[i];
            graph.addLink(link.fromId, link.toId, link.data);
        }
        return graph;
    }
}
