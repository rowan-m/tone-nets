import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NetworkParser } from './NetworkParser.js';

// Mock NetworkParser
vi.mock('./NetworkParser.js', () => ({
    NetworkParser: {
        buildMidiNetwork: vi.fn(),
    },
}));

describe('parser.worker', () => {
    beforeAll(async () => {
        // Mock global self for the worker environment
        global.self = {
            postMessage: vi.fn(),
            onmessage: null,
        };
        // Import the worker to register the onmessage handler
        await import('./parser.worker.js');
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle successful MIDI processing and serialize the graph', async () => {
        const mockGraph = {
            forEachNode: (cb) => {
                cb({ id: 'C4', data: { name: 'C4' } });
                cb({ id: 'G4', data: { name: 'G4' } });
            },
            forEachLink: (cb) => {
                cb({ fromId: 'C4', toId: 'G4', data: { weight: 1 } });
            },
        };
        const mockSummary = { title: 'Test MIDI', vertices: 2, edges: 1 };

        vi.mocked(NetworkParser.buildMidiNetwork).mockResolvedValue({
            graph: mockGraph,
            summary: mockSummary,
        });

        const event = { data: { midiBuffer: new ArrayBuffer(8) } };
        await self.onmessage(event);

        expect(NetworkParser.buildMidiNetwork).toHaveBeenCalledWith(
            event.data.midiBuffer,
        );
        expect(self.postMessage).toHaveBeenCalledWith({
            summary: mockSummary,
            serializedGraph: {
                nodes: [
                    { id: 'C4', data: { name: 'C4' } },
                    { id: 'G4', data: { name: 'G4' } },
                ],
                links: [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            },
        });
    });

    it('should handle errors in NetworkParser.buildMidiNetwork and post the error message', async () => {
        const errorMessage = 'Invalid MIDI file';
        vi.mocked(NetworkParser.buildMidiNetwork).mockRejectedValue(
            new Error(errorMessage),
        );

        const event = { data: { midiBuffer: new ArrayBuffer(0) } };
        await self.onmessage(event);

        expect(self.postMessage).toHaveBeenCalledWith({
            error: errorMessage,
        });
    });

    it('should handle unexpected errors and post the error message', async () => {
        vi.mocked(NetworkParser.buildMidiNetwork).mockImplementation(() => {
            throw new Error('Unexpected crash');
        });

        const event = { data: { midiBuffer: null } };
        await self.onmessage(event);

        expect(self.postMessage).toHaveBeenCalledWith({
            error: 'Unexpected crash',
        });
    });
});
