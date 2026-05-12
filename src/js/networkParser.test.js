import { describe, it, expect, vi } from 'vitest';
import { buildMidiNetwork, rebuildGraph } from './networkParser.js';
import { Midi } from '@tonejs/midi';

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

describe('networkParser', () => {
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

        const { graph, summary } = await buildMidiNetwork('test-buffer');

        expect(summary.title).toBe('Loop MIDI');
        expect(summary.duration).toBe(10);
        expect(summary.vertices).toBe(2); // C4 and G4
        expect(summary.edges).toBe(1); // Only C4 -> G4 (C4 -> C4 ignored)

        expect(graph.getLink('C4', 'C4')).toBeUndefined();
        expect(graph.getLink('C4', 'G4')).toBeDefined();
    });

    it('should calculate metrics correctly including weighted efficiency', async () => {
        vi.mocked(Midi).mockImplementationOnce(function () {
            this.name = 'Metric MIDI';
            this.duration = 10;
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
        });

        const { summary } = await buildMidiNetwork('test-buffer');

        expect(summary.density).toBe('1.0000');
        expect(summary.binaryReciprocity).toBe('1.0000');
        expect(summary.reciprocity).toBe('1.0000'); // (min(1,1)+min(1,1))/2 = 1.0
        expect(summary.reciprocityRho).toBe('0.0000');
        expect(summary.entropy).toBe('0.0000');
        expect(summary.efficiency).toBe('1.0000');
        expect(summary.weightedEfficiency).toBe('1.0000');

        // Interval Embedding:
        // C4 (48) -> G4 (55) => 7 semitones
        // G4 (55) -> C4 (48) => -7 semitones => 5 semitones (mod 12)
        // Vector has 1 at index 7 and index 5. Normalized (L2): sqrt(1^2 + 1^2) = sqrt(2). 1/sqrt(2) approx 0.7071
        expect(summary.embedding[7]).toBe('0.7071');
        expect(summary.embedding[5]).toBe('0.7071');
    });

    it('should handle complex transitions and weights for weighted efficiency', async () => {
        vi.mocked(Midi).mockImplementationOnce(function () {
            this.name = 'Complex MIDI';
            this.duration = 10;
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                        { ticks: 300, name: 'G4' },
                    ],
                },
            ];
        });

        const { summary } = await buildMidiNetwork('another-buffer');

        // C4->G4 weight 2, G4->C4 weight 1
        // sum(min) = min(2,1) + min(1,2) = 2
        // total weight = 3
        // weighted reciprocity = 2/3 = 0.6667
        expect(summary.reciprocity).toBe('0.6667');

        // Weighted Efficiency:
        // sum(1/d_w) = 1/(1/2) + 1/(1/1) = 2 + 1 = 3
        // Weighted Efficiency = 3 / (2 * 1) = 1.5
        expect(summary.weightedEfficiency).toBe('1.5000');
    });

    it('should calculate non-zero mean node entropy correctly', async () => {
        vi.mocked(Midi).mockImplementationOnce(function () {
            this.name = 'Entropy MIDI';
            this.duration = 10;
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                        { ticks: 300, name: 'E4' },
                        { ticks: 400, name: 'C4' },
                    ],
                },
            ];
        });

        const { summary } = await buildMidiNetwork('entropy-buffer');

        // Transitions:
        // C4 -> G4 (1)
        // G4 -> C4 (1)
        // C4 -> E4 (1)
        // E4 -> C4 (1)
        // Nodes: C4, G4, E4 (n=3)
        // Node C4: out-weight 2, transitions [1, 1]. p = [0.5, 0.5]. H = 1.0
        // Node G4: out-weight 1, transitions [1]. p = [1.0]. H = 0
        // Node E4: out-weight 1, transitions [1]. p = [1.0]. H = 0
        // Mean Entropy = (1.0 + 0 + 0) / 3 = 0.3333
        expect(summary.entropy).toBe('0.3333');
    });

    describe('extractMetadata', () => {
        it('should combine title and artist from meta events', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.name = 'Moonlight Sonata';
                this.duration = 10;
                this.header = {
                    meta: [{ type: 'text', text: 'Beethoven' }],
                };
                this.tracks = [];
            });

            const { summary } = await buildMidiNetwork('meta-buffer');
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

            const { summary } = await buildMidiNetwork('meta-buffer');
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

            const { summary } = await buildMidiNetwork('meta-buffer');
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

            const { summary } = await buildMidiNetwork('drum-buffer');
            expect(summary.vertices).toBe(2); // Only C4 and G4
            expect(summary.edges).toBe(1);
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

            const { summary, graph } = await buildMidiNetwork('chord-buffer');
            // C4 -> G4, E4 -> G4
            expect(summary.vertices).toBe(3);
            expect(summary.edges).toBe(2);
            expect(graph.getLink('C4', 'G4')).toBeDefined();
            expect(graph.getLink('E4', 'G4')).toBeDefined();
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

            const graph = rebuildGraph(serialized);
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

            const graph = rebuildGraph(serialized);
            expect(graph.getLink('C4', 'G4')).toBeDefined();
        });
    });

    describe('Internal Distance Helpers', () => {
        it('should handle cycles in BFS (BFS branch)', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 100, name: 'G4' },
                            { ticks: 200, name: 'C4' },
                            { ticks: 300, name: 'G4' },
                        ],
                    },
                ];
            });
            // This creates C4 -> G4 and G4 -> C4
            // When BFS starts at C4, it sees G4. Then from G4 it sees C4 (already visited).
            const { summary } = await buildMidiNetwork('cycle-buffer');
            expect(summary.efficiency).toBe('1.0000');
        });
    });

    describe('Metric Edge Cases', () => {
        it('should handle empty MIDI', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 0;
                this.tracks = [];
            });
            const { summary } = await buildMidiNetwork('empty-buffer');
            expect(summary.vertices).toBe(0);
            expect(summary.edges).toBe(0);
            expect(summary.density).toBe('0.0000');
            expect(summary.embedding).toEqual(new Array(12).fill('0.0000'));
        });

        it('should handle single node MIDI', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 0,
                        notes: [{ ticks: 0, name: 'C4' }],
                    },
                ];
            });
            const { summary } = await buildMidiNetwork('single-buffer');
            // Current implementation only adds nodes if they are part of a transition
            expect(summary.vertices).toBe(0);
            expect(summary.edges).toBe(0);
            expect(summary.density).toBe('0.0000');
            expect(summary.efficiency).toBe('0.0000');
        });

        it('should handle disconnected nodes for efficiency', async () => {
            vi.mocked(Midi).mockImplementationOnce(function () {
                this.duration = 10;
                this.tracks = [
                    {
                        channel: 0,
                        notes: [
                            { ticks: 0, name: 'C4' },
                            { ticks: 100, name: 'G4' },
                        ],
                    },
                    {
                        channel: 1,
                        notes: [
                            { ticks: 0, name: 'A4' },
                            { ticks: 100, name: 'B4' },
                        ],
                    },
                ];
            });
            const { summary } = await buildMidiNetwork('disconnected-buffer');
            // C4 -> G4, A4 -> B4. No path between {C4,G4} and {A4,B4}
            expect(summary.vertices).toBe(4);
            expect(summary.efficiency).not.toBe('0.0000');
            expect(parseFloat(summary.efficiency)).toBeLessThan(1.0);
        });
    });
});
