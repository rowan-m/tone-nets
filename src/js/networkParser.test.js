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

        // n = 2 (C4, G4)
        // edges = 2 (C4->G4, G4->C4)
        // density = 2 / (2 * 1) = 1.0
        expect(summary.density).toBe('1.0000');

        // Weighted Reciprocity: both links are reciprocated
        expect(summary.reciprocity).toBe('1.0000');
        // Rho: (1.0 - 1.0) / (1.0 - 1.0) -> handled as 0 or 1? 
        // In my code: (weightedReciprocity - density) / (1 - density)
        // (1 - 1) / (1 - 1) => 0/0 => handled by (1-density) > 0 check -> 0
        expect(summary.reciprocityRho).toBe('0.0000');

        // Global Efficiency (Unweighted):
        // d(C4, G4) = 1, d(G4, C4) = 1
        // sum(1/d) = 1/1 + 1/1 = 2
        // Efficiency = 2 / (2 * 1) = 1.0
        expect(summary.efficiency).toBe('1.0000');

        // Weighted Efficiency:
        // weights are 1. d_w(C4, G4) = 1, d_w(G4, C4) = 1
        // sum(1/d_w) = 1/1 + 1/1 = 2
        // Weighted Efficiency = 2 / (2 * 1) = 1.0
        expect(summary.weightedEfficiency).toBe('1.0000');

        // Interval Embedding:
        // C4 (48) -> G4 (55) => 7 semitones
        // G4 (55) -> C4 (48) => 7 semitones
        expect(summary.embedding[7]).toBe('1.0000');
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
                        { ticks: 300, name: 'G4' } // C4->G4 and G4->C4 both weight 2
                    ]
                }
            ];
        });

        const { summary } = await buildMidiNetwork('another-buffer');

        // Weighted distance C4 -> G4 is weight 2 (from t=0->100 and t=200->300)
        // Weighted distance G4 -> C4 is weight 1 (from t=100->200)
        // sum(1/d_w) = 1/2 + 1/1 = 1.5
        // Weighted Efficiency = 1.5 / (2 * 1) = 0.75
        expect(summary.weightedEfficiency).toBe('0.7500');
        expect(summary.efficiency).toBe('1.0000'); // Unweighted still 1.0
    });
});

