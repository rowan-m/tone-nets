import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkParser } from './NetworkParser.js';
import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { NetworkMetrics } from './NetworkMetrics.js';

// Mock @tonejs/midi
vi.mock('@tonejs/midi', () => {
    return {
        Midi: vi.fn().mockImplementation(() => ({
            name: '',
            tracks: [],
            header: { meta: [] },
            duration: 0,
        })),
    };
});

// Mock NetworkMetrics
vi.mock('./NetworkMetrics.js', () => ({
    NetworkMetrics: {
        calculateAll: vi.fn(() => ({
            vertices: 0,
            edges: 0,
            density: '0.0000',
            reciprocity: '0.0000',
            binaryReciprocity: '0.0000',
            reciprocityRho: '0.0000',
            entropy: '0.0000',
            efficiency: '0.0000',
            weightedEfficiency: '0.0000',
            embedding: Array.from({ length: 12 }, () => '0.0000'),
        })),
    },
}));

describe('NetworkParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('extractMetadata', () => {
        it('should combine title and artist from meta events when both are present', () => {
            // Arrange
            const mockMidi = {
                name: 'Moonlight Sonata',
                header: {
                    meta: [
                        { type: 'copyright', text: 'ignored' },
                        { type: 'text', text: 'Beethoven' },
                    ],
                },
            };

            // Act
            const title = NetworkParser.extractMetadata(mockMidi);

            // Assert
            expect(title).toBe('Moonlight Sonata - Beethoven');
        });

        it('should use meta event as title if name is missing', () => {
            // Arrange
            const mockMidi = {
                name: '',
                header: {
                    meta: [{ type: 'trackName', text: 'Opus 27' }],
                },
            };

            // Act
            const title = NetworkParser.extractMetadata(mockMidi);

            // Assert
            expect(title).toBe('Opus 27');
        });

        it('should ignore "Track X" placeholders and duplicate titles in meta events', () => {
            // Arrange
            const mockMidi = {
                name: 'Sonata',
                header: {
                    meta: [
                        { type: 'text', text: 'Track 1' },
                        { type: 'text', text: 'Sonata' }, // Duplicate
                        { type: 'text', text: 'Ludwig' },
                    ],
                },
            };

            // Act
            const title = NetworkParser.extractMetadata(mockMidi);

            // Assert
            expect(title).toBe('Sonata - Ludwig');
        });

        it('should return empty string if no metadata is found', () => {
            // Arrange
            const mockMidi = {
                name: '',
                header: { meta: [] },
            };

            // Act
            const title = NetworkParser.extractMetadata(mockMidi);

            // Assert
            expect(title).toBe('');
        });
    });

    describe('processTransitions', () => {
        it('should ignore drum tracks (channel 9)', () => {
            // Arrange
            const midi = {
                tracks: [
                    {
                        channel: 9,
                        notes: [
                            { ticks: 0, name: 'C2' },
                            { ticks: 100, name: 'D2' },
                        ],
                    },
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 100, name: 'G4' },
                        ],
                    },
                ],
            };
            const graph = createGraph();

            // Act
            const edgeCount = NetworkParser.processTransitions(midi, graph);

            // Assert
            expect(edgeCount).toBe(1);
            expect(graph.getLinksCount()).toBe(1);
            expect(graph.getLink('C4', 'G4')).toBeDefined();
        });

        it('should handle chords by creating transitions to all notes in the next time step', () => {
            // Arrange
            const midi = {
                tracks: [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 0, name: 'E4' },
                            { ticks: 100, name: 'G4' },
                        ],
                    },
                ],
            };
            const graph = createGraph();

            // Act
            NetworkParser.processTransitions(midi, graph);

            // Assert
            // Transitions: C4 -> G4 and E4 -> G4
            expect(graph.getLink('C4', 'G4')).toBeDefined();
            expect(graph.getLink('E4', 'G4')).toBeDefined();
        });

        it('should handle multiple occurrences of the same note in a chord', () => {
            // Arrange
            const midi = {
                tracks: [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 0, name: 'C4' }, // Duplicate note at same time
                            { ticks: 100, name: 'G4' },
                        ],
                    },
                ],
            };
            const graph = createGraph();

            // Act
            NetworkParser.processTransitions(midi, graph);

            // Assert
            // C4 -> G4 should have weight 2 (2 sources * 1 target)
            const link = graph.getLink('C4', 'G4');
            expect(link.data.weight).toBe(2);
        });

        it('should return 0 edge count if no transitions exist', () => {
            // Arrange
            const midi = {
                tracks: [
                    {
                        channel: 0,
                        notes: [{ ticks: 0, name: 'C4' }],
                    },
                ],
            };
            const graph = createGraph();

            // Act
            const edgeCount = NetworkParser.processTransitions(midi, graph);

            // Assert
            expect(edgeCount).toBe(0);
        });

        it('should ignore self-loops in transitions (same note twice in a row)', () => {
            // Arrange
            const midi = {
                tracks: [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 100, name: 'C4' }, // Self-loop
                            { ticks: 200, name: 'G4' },
                        ],
                    },
                ],
            };
            const graph = createGraph();

            // Act
            NetworkParser.processTransitions(midi, graph);

            // Assert
            expect(graph.getLink('C4', 'C4')).toBeUndefined();
            expect(graph.getLink('C4', 'G4')).toBeDefined();
        });
    });

    describe('addTransition', () => {
        it('should handle nodes that somehow exist but have no data', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A'); // No data
            graph.addNode('B'); // No data

            // Act
            NetworkParser.addTransition(graph, 'A', 'B');

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
        });

        it('should increment weights for existing links', () => {
            // Arrange
            const graph = createGraph();

            // Act
            NetworkParser.addTransition(graph, 'A', 'B');
            NetworkParser.addTransition(graph, 'A', 'B');

            // Assert
            expect(graph.getLink('A', 'B').data.weight).toBe(2);
        });

        it('should return false for self-loops', () => {
            // Arrange
            const graph = createGraph();

            // Act
            const result = NetworkParser.addTransition(graph, 'A', 'A');

            // Assert
            expect(result).toBe(false);
            expect(graph.getLink('A', 'A')).toBeUndefined();
        });

        it('should return false for invalid inputs', () => {
            // Arrange
            const graph = createGraph();

            // Act & Assert
            expect(NetworkParser.addTransition(graph, null, 'B')).toBe(false);
            expect(NetworkParser.addTransition(graph, 'A', undefined)).toBe(
                false,
            );
        });

        it('should update node degrees incrementally for new links', () => {
            // Arrange
            const graph = createGraph();

            // Act
            NetworkParser.addTransition(graph, 'A', 'B');

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
        });

        it('should not increment node degrees for existing links', () => {
            // Arrange
            const graph = createGraph();
            NetworkParser.addTransition(graph, 'A', 'B');

            // Act
            NetworkParser.addTransition(graph, 'A', 'B');

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
        });
    });

    describe('computeNodeDegrees', () => {
        it('should calculate degree for all nodes correctly', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'B');
            graph.addLink('B', 'C');
            graph.addLink('A', 'C');

            // Act
            NetworkParser.computeNodeDegrees(graph);

            // Assert
            expect(graph.getNode('A').data.degree).toBe(2);
            expect(graph.getNode('B').data.degree).toBe(2);
            expect(graph.getNode('C').data.degree).toBe(2);
        });

        it('should handle nodes without data objects', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A'); // No data
            graph.addLink('A', 'B');

            // Act
            NetworkParser.computeNodeDegrees(graph);

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
        });

        it('should handle self-loops correctly by counting them once', () => {
            // Arrange
            const graph = createGraph();
            graph.addLink('A', 'A');

            // Act
            NetworkParser.computeNodeDegrees(graph);

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
        });
    });

    describe('updateOrCreateLink', () => {
        it('should initialize data if node exists but has no data', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A'); // No data
            graph.addNode('B'); // No data

            // Act
            NetworkParser.updateOrCreateLink(graph, 'A', 'B');

            // Assert
            expect(graph.getNode('A').data).toBeDefined();
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
        });
    });

    describe('rebuildGraph', () => {
        it('should rebuild a graph from serialized data including all node and link properties', () => {
            // Arrange
            const serialized = {
                nodes: [
                    { id: 'C4', data: { name: 'C4', degree: 10 } },
                    { id: 'G4', data: { name: 'G4', degree: 5 } },
                ],
                links: [
                    {
                        fromId: 'C4',
                        toId: 'G4',
                        data: { weight: 5, id: 'C4->G4' },
                    },
                ],
            };

            // Act
            const graph = NetworkParser.rebuildGraph(serialized);

            // Assert
            expect(graph.getNodesCount()).toBe(2);
            expect(graph.getLinksCount()).toBe(1);
            expect(graph.getNode('C4').data.degree).toBe(10);
            expect(graph.getLink('C4', 'G4').data.weight).toBe(5);
        });
    });

    describe('buildMidiNetwork', () => {
        it('should orchestrate the full network building process', async () => {
            // Arrange
            const mockBuffer = new ArrayBuffer(8);
            vi.mocked(Midi).mockImplementationOnce(function () {
                return {
                    name: 'Test MIDI',
                    duration: 120,
                    tracks: [
                        {
                            channel: 0,
                            notes: [
                                { ticks: 0, name: 'C4' },
                                { ticks: 100, name: 'G4' },
                            ],
                        },
                    ],
                    header: { meta: [] },
                };
            });

            // Act
            const { graph, summary } =
                await NetworkParser.buildMidiNetwork(mockBuffer);

            // Assert
            expect(summary.title).toBe('Test MIDI');
            expect(summary.duration).toBe(120);
            expect(graph.getNodesCount()).toBe(2);
            expect(graph.getLinksCount()).toBe(1);
            expect(NetworkMetrics.calculateAll).toHaveBeenCalled();
        });

        it('should handle MIDI with no transitions', async () => {
            // Arrange
            const mockBuffer = new ArrayBuffer(8);
            vi.mocked(Midi).mockImplementationOnce(function () {
                return {
                    name: 'Single Note',
                    duration: 1,
                    tracks: [{ channel: 0, notes: [{ ticks: 0, name: 'C4' }] }],
                    header: { meta: [] },
                };
            });

            // Act
            const { graph, summary } =
                await NetworkParser.buildMidiNetwork(mockBuffer);

            // Assert
            expect(graph.getLinksCount()).toBe(0);
            expect(summary.edges).toBe(0);
        });
    });

    describe('calculateMetrics', () => {
        it('should delegate to NetworkMetrics.calculateAll', () => {
            // Arrange
            const graph = createGraph();
            const edgeCount = 5;

            // Act
            NetworkParser.calculateMetrics(graph, edgeCount);

            // Assert
            expect(NetworkMetrics.calculateAll).toHaveBeenCalledWith(
                graph,
                edgeCount,
            );
        });
    });
});
