import { describe, it, expect, vi } from 'vitest';
import { NetworkParser } from './NetworkParser.js';
import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { NetworkMetrics } from './NetworkMetrics.js';

// Mock @tonejs/midi
vi.mock('@tonejs/midi', () => {
    const MidiMock = vi.fn(function (buffer) {
        this.name = '';
        this.tracks = [];
        this.header = { meta: [] };
        this.duration = 10;

        if (buffer === 'test-buffer') {
            this.name = 'Test MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                    ],
                },
            ];
        }
    });
    return { Midi: MidiMock };
});

// Mock NetworkMetrics
vi.mock('./NetworkMetrics.js', () => ({
    NetworkMetrics: {
        calculateAll: vi.fn(() => ({
            vertices: 2,
            edges: 1,
            density: '0.5000',
            reciprocity: '0.0000',
            binaryReciprocity: '0.0000',
            reciprocityRho: '0.0000',
            entropy: '0.0000',
            efficiency: '0.5000',
            weightedEfficiency: '0.5000',
            embedding: new Array(12).fill('0.0000'),
        })),
    },
}));

describe('NetworkParser', () => {
    describe('buildMidiNetwork', () => {
        it('should build a network from MIDI data and ignore self-loops', async () => {
            // Arrange
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Loop MIDI';
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 100, name: 'C4' }, // Self-loop
                            { ticks: 200, name: 'G4' },
                        ],
                    },
                ];
            });

            // Act
            const { graph, summary } =
                await NetworkParser.buildMidiNetwork('test-buffer');

            // Assert
            expect(summary.title).toBe('Loop MIDI');
            expect(graph.getLink('C4', 'C4')).toBeUndefined();
            expect(graph.getLink('C4', 'G4')).toBeDefined();
            expect(NetworkMetrics.calculateAll).toHaveBeenCalled();
        });
    });

    describe('extractMetadata', () => {
        it('should combine title and artist from meta events', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Moonlight Sonata';
                this.header = {
                    meta: [
                        { type: 'copyright', text: 'ignored' },
                        { type: 'text', text: 'Beethoven' },
                    ],
                };
            });

            const title = NetworkParser.extractMetadata(new Midi());
            expect(title).toBe('Moonlight Sonata - Beethoven');
        });

        it('should use meta event as title if name is missing', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = '';
                this.header = {
                    meta: [{ type: 'trackName', text: 'Opus 27' }],
                };
            });

            const title = NetworkParser.extractMetadata(new Midi());
            expect(title).toBe('Opus 27');
        });

        it('should ignore "Track X" and duplicate titles in meta events', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Sonata';
                this.header = {
                    meta: [
                        { type: 'text', text: 'Track 1' },
                        { type: 'text', text: 'Sonata' }, // Duplicate
                        { type: 'text', text: 'Ludwig' },
                    ],
                };
            });

            const title = NetworkParser.extractMetadata(new Midi());
            expect(title).toBe('Sonata - Ludwig');
        });

        it('should return empty string if no metadata is found', () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = '';
                this.header = { meta: [] };
            });
            const title = NetworkParser.extractMetadata(new Midi());
            expect(title).toBe('');
        });
    });

    describe('processTransitions', () => {
        it('should ignore drum tracks (channel 9)', async () => {
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
            const edgeCount = NetworkParser.processTransitions(midi, graph);

            expect(edgeCount).toBe(1);
            expect(graph.getLinksCount()).toBe(1);
        });

        it('should handle chords (multiple notes at same time)', async () => {
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
            NetworkParser.processTransitions(midi, graph);

            // C4 -> G4, E4 -> G4
            expect(graph.getLink('C4', 'G4')).toBeDefined();
            expect(graph.getLink('E4', 'G4')).toBeDefined();
        });
    });

    describe('computeNodeDegrees', () => {
        it('should calculate degree for nodes and handle missing data objects', () => {
            // Arrange
            const graph = createGraph();
            graph.addNode('A'); // No data
            graph.addNode('B', { custom: 'data' });
            graph.addLink('A', 'B');

            // Act
            NetworkParser.computeNodeDegrees(graph);

            // Assert
            expect(graph.getNode('A').data.degree).toBe(1);
            expect(graph.getNode('B').data.degree).toBe(1);
            expect(graph.getNode('B').data.custom).toBe('data');
        });

        it('should handle self-loops correctly (though parser avoids them)', () => {
            const graph = createGraph();
            graph.addLink('A', 'A');
            NetworkParser.computeNodeDegrees(graph);
            expect(graph.getNode('A').data.degree).toBe(1); // Only counted once
        });
    });

    describe('rebuildGraph', () => {
        it('should rebuild a graph from serialized data', () => {
            // Arrange
            const serialized = {
                nodes: [
                    { id: 'C4', data: { name: 'C4' } },
                    { id: 'G4', data: { name: 'G4' } },
                ],
                links: [{ fromId: 'C4', toId: 'G4', data: { weight: 5 } }],
            };

            // Act
            const graph = NetworkParser.rebuildGraph(serialized);

            // Assert
            expect(graph.getNodesCount()).toBe(2);
            expect(graph.getLinksCount()).toBe(1);
            const link = graph.getLink('C4', 'G4');
            expect(link.data.weight).toBe(5);
        });
    });

    describe('addTransition', () => {
        it('should increment weights for existing links', () => {
            const graph = createGraph();
            NetworkParser.addTransition(graph, 'A', 'B');
            NetworkParser.addTransition(graph, 'A', 'B');

            expect(graph.getLink('A', 'B').data.weight).toBe(2);
        });

        it('should return false for self-loops or invalid inputs', () => {
            const graph = createGraph();
            expect(NetworkParser.addTransition(graph, 'A', 'A')).toBe(false);
            expect(NetworkParser.addTransition(graph, null, 'B')).toBe(false);
        });
    });
});
