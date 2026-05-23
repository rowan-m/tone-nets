import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    beforeAll,
    afterAll,
} from 'vitest';
import { NetworkParser } from './NetworkParser.js';

// Mock NetworkParser to isolate worker logic from actual parsing complexity
vi.mock('./NetworkParser.js', () => ({
    NetworkParser: {
        buildMidiNetwork: vi.fn(),
    },
}));

describe('parser.worker', () => {
    let originalSelf;

    beforeAll(async () => {
        // Mock global self to simulate the Web Worker environment
        originalSelf = global.self;
        global.self = {
            postMessage: vi.fn(),
            onmessage: null,
        };

        // Dynamically import the worker to trigger its side-effect: registering the onmessage handler
        // In a real worker, this happens when the script is loaded.
        await import('./parser.worker.js');
    });

    afterAll(() => {
        // Restore the global environment
        global.self = originalSelf;
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should parse MIDI buffer and post the serialized graph and summary back to the main thread', async () => {
        // Arrange: Setup mock graph data and summary
        const mockNodes = [
            { id: 'C4', data: { name: 'C4', degree: 1 } },
            { id: 'E4', data: { name: 'E4', degree: 1 } },
        ];
        const mockLinks = [{ fromId: 'C4', toId: 'E4', data: { weight: 1 } }];

        // Mock a graph object that supports the iteration methods used by the worker
        const mockGraph = {
            forEachNode: (callback) => mockNodes.forEach(callback),
            forEachLink: (callback) => mockLinks.forEach(callback),
        };

        const mockSummary = {
            title: 'Test Composition',
            duration: 120,
            vertices: 2,
            edges: 1,
            efficiency: 0.8,
        };

        vi.mocked(NetworkParser.buildMidiNetwork).mockResolvedValue({
            graph: mockGraph,
            summary: mockSummary,
        });

        const midiBuffer = new ArrayBuffer(16);
        const messageEvent = { data: { midiBuffer } };

        // Act: Invoke the worker's message handler
        await self.onmessage(messageEvent);

        // Assert: Verify the worker correctly delegated parsing and sent back the expected payload
        expect(NetworkParser.buildMidiNetwork).toHaveBeenCalledWith(midiBuffer);
        expect(self.postMessage).toHaveBeenCalledWith({
            summary: mockSummary,
            serializedGraph: {
                nodes: mockNodes,
                links: mockLinks,
            },
        });
    });

    it('should communicate parsing failures back to the main thread via an error message', async () => {
        // Arrange: Mock a rejection from the parser
        const errorMessage = 'Midi parsing failed: Invalid header';
        vi.mocked(NetworkParser.buildMidiNetwork).mockRejectedValue(
            new Error(errorMessage),
        );

        const messageEvent = { data: { midiBuffer: new ArrayBuffer(0) } };

        // Act: Invoke the worker's message handler
        await self.onmessage(messageEvent);

        // Assert: Verify the error was caught and posted back
        expect(self.postMessage).toHaveBeenCalledWith({
            error: errorMessage,
        });
    });

    it('should handle unexpected runtime exceptions gracefully', async () => {
        // Arrange: Mock an unexpected crash during execution
        vi.mocked(NetworkParser.buildMidiNetwork).mockImplementation(() => {
            throw new Error('Internal worker crash');
        });

        const messageEvent = { data: { midiBuffer: null } };

        // Act: Invoke the worker's message handler
        await self.onmessage(messageEvent);

        // Assert: Verify the crash was handled
        expect(self.postMessage).toHaveBeenCalledWith({
            error: 'Internal worker crash',
        });
    });

    it('should handle an empty graph correctly during serialization', async () => {
        // Arrange: Mock an empty graph (edge case)
        const mockGraph = {
            forEachNode: vi.fn(),
            forEachLink: vi.fn(),
        };
        const mockSummary = { title: 'Empty', vertices: 0, edges: 0 };

        vi.mocked(NetworkParser.buildMidiNetwork).mockResolvedValue({
            graph: mockGraph,
            summary: mockSummary,
        });

        const messageEvent = { data: { midiBuffer: new ArrayBuffer(4) } };

        // Act
        await self.onmessage(messageEvent);

        // Assert: Nodes and links should be empty arrays
        expect(self.postMessage).toHaveBeenCalledWith({
            summary: mockSummary,
            serializedGraph: {
                nodes: [],
                links: [],
            },
        });
    });
});
