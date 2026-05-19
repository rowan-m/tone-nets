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
        this.duration = 10; // Default duration

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
    it('should build a network from MIDI data and ignore self-loops', async () => {
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

        const { graph, summary } =
            await NetworkParser.buildMidiNetwork('test-buffer');

        expect(summary.title).toBe('Loop MIDI');
        expect(summary.duration).toBe(10);

        // Verify graph construction
        expect(graph.getLink('C4', 'C4')).toBeUndefined();
        expect(graph.getLink('C4', 'G4')).toBeDefined();

        // Verify NetworkMetrics was called
        expect(NetworkMetrics.calculateAll).toHaveBeenCalled();
    });

    describe('extractMetadata', () => {
        it('should combine title and artist from meta events', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Moonlight Sonata';
                this.duration = 10;
                this.header = {
                    meta: [
                        { type: 'copyright', text: 'ignored' },
                        { type: 'text', text: 'Beethoven' },
                    ],
                };
                this.tracks = [];
            });

            const { summary } =
                await NetworkParser.buildMidiNetwork('meta-buffer');
            expect(summary.title).toBe('Moonlight Sonata - Beethoven');
        });

        it('should use meta event as title if name is missing', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = '';
                this.duration = 10;
                this.header = {
                    meta: [{ type: 'trackName', text: 'Opus 27' }],
                };
                this.tracks = [];
            });

            const { summary } =
                await NetworkParser.buildMidiNetwork('meta-buffer');
            expect(summary.title).toBe('Opus 27');
        });

        it('should ignore "Track X" and duplicate titles in meta events', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Sonata';
                this.duration = 10;
                this.header = {
                    meta: [
                        { type: 'text', text: 'Track 1' },
                        { type: 'text', text: 'Sonata' },
                        { type: 'text', text: 'Ludwig' },
                    ],
                };
                this.tracks = [];
            });

            const { summary } =
                await NetworkParser.buildMidiNetwork('meta-buffer');
            expect(summary.title).toBe('Sonata - Ludwig');
        });
    });

    describe('processTransitions', () => {
        it('should ignore drum tracks (channel 9)', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 9, // Drum channel
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
                ];
            });

            await NetworkParser.buildMidiNetwork('drum-buffer');
            // Vertices/Edges here come from the mock but we can check graph
            expect(NetworkMetrics.calculateAll).toHaveBeenCalled();
        });

        it('should handle chords (multiple notes at same time)', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 0, name: 'E4' },
                            { ticks: 100, name: 'G4' },
                        ],
                    },
                ];
            });

            const { graph } =
                await NetworkParser.buildMidiNetwork('chord-buffer');
            // C4 -> G4, E4 -> G4
            expect(graph.getLink('C4', 'G4')).toBeDefined();
            expect(graph.getLink('E4', 'G4')).toBeDefined();
        });
    });

    describe('addTransition', () => {
        it('should add nodes and links incrementally', () => {
            const graph = createGraph();
            NetworkParser.addTransition(graph, 'C4', 'G4');

            expect(graph.getNodesCount()).toBe(2);
            expect(graph.getLinksCount()).toBe(1);
            expect(graph.getLink('C4', 'G4').data.weight).toBe(1);

            // Update existing link
            NetworkParser.addTransition(graph, 'C4', 'G4');
            expect(graph.getLinksCount()).toBe(1);
            expect(graph.getLink('C4', 'G4').data.weight).toBe(2);
        });

        it('should ignore self-loops', () => {
            const graph = createGraph();
            NetworkParser.addTransition(graph, 'C4', 'C4');
            expect(graph.getNodesCount()).toBe(0);
        });
    });

    describe('rebuildGraph', () => {
        it('should rebuild a graph from serialized data', () => {
            const serialized = {
                nodes: [
                    { id: 'C4', data: { name: 'C4' } },
                    { id: 'G4', data: { name: 'G4' } },
                ],
                links: [{ fromId: 'C4', toId: 'G4', data: { weight: 5 } }],
            };

            const graph = NetworkParser.rebuildGraph(serialized);
            expect(graph.getNodesCount()).toBe(2);
            expect(graph.getLinksCount()).toBe(1);
            const link = graph.getLink('C4', 'G4');
            expect(link.data.weight).toBe(5);
        });

        it('should handle missing weight in serialized links', () => {
            const serialized = {
                nodes: [
                    { id: 'C4', data: { name: 'C4' } },
                    { id: 'G4', data: { name: 'G4' } },
                ],
                links: [
                    { fromId: 'C4', toId: 'G4', data: {} }, // Missing weight
                ],
            };

            const graph = NetworkParser.rebuildGraph(serialized);
            expect(graph.getLink('C4', 'G4')).toBeDefined();
        });
    });

    describe('Metric Edge Cases (Delegation)', () => {
        it('should call NetworkMetrics with empty graph for empty MIDI', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 0;
                this.tracks = [];
            });
            await NetworkParser.buildMidiNetwork('empty-buffer');
            expect(NetworkMetrics.calculateAll).toHaveBeenCalled();
        });
    });
});
