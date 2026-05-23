import { describe, it, expect } from 'vitest';
import createGraph from 'ngraph.graph';
import { NetworkParser } from './NetworkParser.js';

describe('Benchmark NetworkParser', () => {
    it('benchmarks processTransitions', () => {
        const mockMidi = {
            name: 'Benchmark MIDI',
            tracks: [
                {
                    channel: 0,
                    notes: [],
                },
            ],
        };

        // Generate 500 time steps with 200 notes each
        for (let t = 0; t < 500; t++) {
            for (let n = 0; n < 200; n++) {
                mockMidi.tracks[0].notes.push({
                    ticks: t * 100,
                    name: `Note_${n % 12}_${Math.floor(n / 12)}`, // Random note names
                });
            }
        }

        const start = performance.now();
        const graph = createGraph();
        const edges = NetworkParser.processTransitions(mockMidi, graph);
        const end = performance.now();

        console.log(`Time: ${(end - start).toFixed(2)} ms`);
        expect(edges).toBeGreaterThan(0);
    }, 30000); // 30 second timeout
});
