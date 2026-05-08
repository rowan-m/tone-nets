import { describe, it, expect, vi } from 'vitest';
import { buildMidiNetwork } from './networkParser.js';
import { Midi } from '@tonejs/midi';

// Mock @tonejs/midi
vi.mock('@tonejs/midi', () => {
    const MidiMock = vi.fn(function(buffer) {
        if (buffer === 'test-buffer') {
            this.name = 'Test MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' }
                    ]
                }
            ];
        } else {
            this.tracks = [];
        }
    });
    return { Midi: MidiMock };
});

describe('networkParser', () => {
    it('should build a network from MIDI data', async () => {
        const { graph, summary } = await buildMidiNetwork('test-buffer');

        expect(summary.title).toBe('Test MIDI');
        expect(summary.vertices).toBe(2); // C4 and G4
        expect(summary.edges).toBe(2);    // C4 -> G4 and G4 -> C4

        // Check if nodes exist
        expect(graph.getNode('C4')).toBeDefined();
        expect(graph.getNode('G4')).toBeDefined();

        // Check links and weights
        const link1 = graph.getLink('C4', 'G4');
        expect(link1).toBeDefined();
        expect(link1.data.weight).toBe(1);

        const link2 = graph.getLink('G4', 'C4');
        expect(link2).toBeDefined();
        expect(link2.data.weight).toBe(1);
    });

    it('should calculate metrics correctly', async () => {
        const { summary } = await buildMidiNetwork('test-buffer');

        // For a simple C4 -> G4 -> C4 network:
        // n = 2
        // edges = 2 (C4->G4, G4->C4)
        // density = 2 / (2 * 1) = 1.0
        expect(summary.density).toBe('1.0000');

        // Weighted Reciprocity: both links are reciprocated
        // Total weight = 2, Reciprocated weight = 2
        // reciprocity = 2/2 = 1.0
        expect(summary.reciprocity).toBe('1.0000');

        // Entropy:
        // C4 has 1 out-link (to G4). Entropy = 0.
        // G4 has 1 out-link (to C4). Entropy = 0.
        // Mean Entropy = 0
        expect(summary.entropy).toBe('0.0000');

        // Global Efficiency:
        // d(C4, G4) = 1, d(G4, C4) = 1
        // sum(1/d) = 1/1 + 1/1 = 2
        // Efficiency = 2 / (2 * 1) = 1.0
        expect(summary.efficiency).toBe('1.0000');

        // Interval Embedding:
        // C4 (48) -> G4 (55) => 7 semitones
        // G4 (55) -> C4 (48) => 7 semitones (modulo 12)
        // Total weight = 2. 7-th index (Perfect Fifth) should be 1.0, others 0.
        expect(summary.embedding[7]).toBe('1.0000');
        expect(summary.embedding[0]).toBe('0.0000');
    });

    it('should handle complex transitions and weights', async () => {
        vi.mocked(Midi).mockImplementationOnce(function() {
            this.name = 'Complex MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 0, name: 'E4' }, // Chord
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                        { ticks: 200, name: 'E4' } // Back to chord
                    ]
                }
            ];
        });

        const { graph, summary } = await buildMidiNetwork('another-buffer');

        // Nodes: C4, E4, G4
        expect(summary.vertices).toBe(3);
        
        // Transitions:
        // t=0 {C4, E4} -> t=100 {G4}  => C4->G4, E4->G4
        // t=100 {G4} -> t=200 {C4, E4} => G4->C4, G4->E4
        // Total edges = 4
        expect(summary.edges).toBe(4);

        expect(graph.getLink('C4', 'G4').data.weight).toBe(1);
        expect(graph.getLink('G4', 'C4').data.weight).toBe(1);
    });
});

