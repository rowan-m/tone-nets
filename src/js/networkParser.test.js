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
    it('should build a network from MIDI data and ignore self-loops', async () => {
        vi.mocked(Midi).mockImplementationOnce(function() {
            this.name = 'Loop MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'C4' }, // Self-loop
                        { ticks: 200, name: 'G4' }
                    ]
                }
            ];
        });

        const { graph, summary } = await buildMidiNetwork('test-buffer');

        expect(summary.title).toBe('Loop MIDI');
        expect(summary.vertices).toBe(2); // C4 and G4
        expect(summary.edges).toBe(1);    // Only C4 -> G4 (C4 -> C4 ignored)

        expect(graph.getLink('C4', 'C4')).toBeUndefined();
        expect(graph.getLink('C4', 'G4')).toBeDefined();
    });

    it('should calculate metrics correctly including weighted efficiency', async () => {
        vi.mocked(Midi).mockImplementationOnce(function() {
            this.name = 'Metric MIDI';
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
        vi.mocked(Midi).mockImplementationOnce(function() {
            this.name = 'Complex MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                        { ticks: 300, name: 'G4' } 
                    ]
                }
            ];
        });

        const { summary } = await buildMidiNetwork('another-buffer');

        // C4->G4 weight 2, G4->C4 weight 1
        // sum(min) = min(2,1) + min(1,2) = 2
        // total weight = 3
        // weighted reciprocity = 2/3 = 0.6667
        expect(summary.reciprocity).toBe('0.6667');
        
        // Weighted Efficiency:
        // sum(1/d_w) = 1/2 + 1/1 = 1.5
        // Weighted Efficiency = 1.5 / (2 * 1) = 0.75
        expect(summary.weightedEfficiency).toBe('0.7500');
    });

    it('should calculate non-zero mean node entropy correctly', async () => {
        vi.mocked(Midi).mockImplementationOnce(function() {
            this.name = 'Entropy MIDI';
            this.tracks = [
                {
                    channel: 0,
                    notes: [
                        { ticks: 0, name: 'C4' },
                        { ticks: 100, name: 'G4' },
                        { ticks: 200, name: 'C4' },
                        { ticks: 300, name: 'E4' },
                        { ticks: 400, name: 'C4' }
                    ]
                }
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
});

