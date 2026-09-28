import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorker = {
    postMessage: vi.fn(),
    onmessage: null,
};

vi.stubGlobal(
    'Worker',
    vi.fn().mockImplementation(function () {
        return mockWorker;
    }),
);

vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    visibilityState: 'visible',
});

vi.stubGlobal(
    'MediaMetadata',
    vi.fn().mockImplementation(function (meta) {
        return meta;
    }),
);

vi.stubGlobal('navigator', {
    mediaSession: {
        metadata: null,
    },
});

const mockVisualizerInstance = {
    themeManager: {
        registerTheme: vi.fn(),
        getCurrentTheme: vi.fn(() => ({ name: 'default' })),
        getTheme: vi.fn(() => ({ name: 'default' })),
    },
    setTheme: vi.fn(),
    cycleTheme: vi.fn(() => 'terminator'),
    initIncremental: vi.fn(async function (graph) {
        this.graph = graph;
        if (this.onTourChange) this.onTourChange(true);
    }),
    buildVisualization: vi.fn(async function (graph) {
        this.graph = graph;
        if (this.onTourChange) this.onTourChange(true);
    }),
    layout: {
        step: vi.fn(),
    },
    composer: {
        render: vi.fn(),
    },
    clear: vi.fn(function () {
        if (this.onTourChange) this.onTourChange(false);
    }),
    startAutoTour: vi.fn(function () {
        if (this.onTourChange) this.onTourChange(true);
    }),
    stopAutoTour: vi.fn(function () {
        if (this.onTourChange) this.onTourChange(false);
    }),
    setPaused: vi.fn(),
    resetPlayingHighlights: vi.fn(),
    highlightPlayingElement: vi.fn(),
    releasePlayingElement: vi.fn(),
    showInstrumentEmoji: vi.fn(),
    addTransitionIncremental: vi.fn(),
    onTourChange: null,
    onBeforeFrame: null,
    onHover: null,
    onLayoutProgress: null,
    graph: null,
};

vi.mock('./NetworkVisualizer.js', () => ({
    NetworkVisualizer: vi.fn().mockImplementation(function () {
        return mockVisualizerInstance;
    }),
}));

const mockPlayerInstance = {
    isPlaying: false,
    isLooping: true,
    duration: 0,
    loadSoundfont: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    play: vi.fn(async function (_buffer, autoplay) {
        this.stop();
        await Promise.resolve();
        this.isPlaying = autoplay;
    }),
    stop: vi.fn(function () {
        this.isPlaying = false;
        if (this.onStop) this.onStop();
    }),
    pause: vi.fn(function () {
        this.isPlaying = false;
    }),
    resume: vi.fn(function () {
        this.isPlaying = true;
    }),
    restart: vi.fn(function () {
        if (this.onStop) this.onStop();
    }),
    updateMediaSessionPosition: vi.fn(),
    onNotePlay: null,
    onNoteRelease: null,
    onStop: null,
};

vi.mock('./MidiPlayer.js', () => ({
    MidiPlayer: vi.fn().mockImplementation(function () {
        return mockPlayerInstance;
    }),
}));

let capturedCallbacks = null;
const mockUIInstance = {
    els: {
        uploadInput: { disabled: false },
        playBtn: { disabled: true },
        pauseBtn: { disabled: true },
        restartBtn: { disabled: true },
        tourToggle: { checked: true, disabled: true },
        statsToggle: { checked: false, disabled: true },
        loopToggle: { checked: true },
        infoPanel: { classList: { add: vi.fn(), remove: vi.fn() } },
        welcomeMsg: { classList: { add: vi.fn() } },
        vCountEl: { textContent: 0 },
        eCountEl: { textContent: 0 },
    },
    setThemeUI: vi.fn(),
    showStatus: vi.fn(),
    hideStatus: vi.fn(),
    showError: vi.fn(),
    updateMetrics: vi.fn(),
    setPlaybackUI: vi.fn(),
    updateHoverInfo: vi.fn(),
};

vi.mock('./UIManager.js', () => ({
    UIManager: vi.fn().mockImplementation(function (callbacks) {
        capturedCallbacks = callbacks;
        return mockUIInstance;
    }),
}));

vi.mock('@tonejs/midi', () => ({
    Midi: vi.fn().mockImplementation(function () {
        return { header: { name: 'Mock Track' }, tracks: [] };
    }),
}));

const { init } = await import('./main.js');

const createValidMidiBuffer = () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, 0x4d546864, false); // "MThd"
    return buffer;
};

describe('main orchestrator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPlayerInstance.isPlaying = false;
        mockPlayerInstance.isLooping = true;
        mockUIInstance.els.tourToggle.checked = true;
        mockUIInstance.els.statsToggle.checked = false;
        mockUIInstance.els.statsToggle.disabled = true;
        mockVisualizerInstance.graph = null;
    });

    it('updates Play/Pause UI to Pause when loading an autoplaying MIDI file', async () => {
        await init();
        const midiBuffer = createValidMidiBuffer();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(midiBuffer),
            }),
        );

        capturedCallbacks.onExampleMidiClick('test.mid');
        await vi.waitFor(() => {
            expect(mockPlayerInstance.play).toHaveBeenCalledTimes(1);
            expect(mockPlayerInstance.isPlaying).toBe(true);
        });

        expect(mockUIInstance.setPlaybackUI).toHaveBeenLastCalledWith(true);
    });

    it('restarts the visualization from a fresh load with updated settings when Restart is clicked', async () => {
        await init();
        const midiBuffer = createValidMidiBuffer();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(midiBuffer),
            }),
        );

        // 1. Initial load in incremental (Live Build) mode
        capturedCallbacks.onExampleMidiClick('test.mid');
        await vi.waitFor(() => {
            expect(mockPlayerInstance.play).toHaveBeenCalledTimes(1);
        });

        // 2. User unchecks Live Build and Autoplay, then clicks Restart
        capturedCallbacks.onIncrementalToggle(false);
        capturedCallbacks.onAutoplayToggle(false);
        mockUIInstance.els.tourToggle.checked = false;

        capturedCallbacks.onRestart();

        // Should post the stored MIDI buffer to the worker to build the full visualization
        expect(mockWorker.postMessage).toHaveBeenCalledWith({
            midiBuffer: expect.any(ArrayBuffer),
        });

        // Simulate worker completing full graph build
        mockWorker.onmessage({
            data: {
                summary: {
                    title: 'Mock Track',
                    duration: 120,
                    vertices: 4,
                    edges: 3,
                    embedding: Array.from({ length: 12 }, () => '0.0000'),
                },
                serializedGraph: {
                    nodes: [{ id: 'C4' }, { id: 'G4' }],
                    links: [],
                },
            },
        });

        await vi.waitFor(() => {
            expect(
                mockVisualizerInstance.buildVisualization,
            ).toHaveBeenCalledTimes(1);
            expect(mockPlayerInstance.play).toHaveBeenCalledTimes(2);
        });

        // Should have started play with autoplay = false and preserved tourToggle = false
        expect(mockPlayerInstance.play).toHaveBeenLastCalledWith(
            expect.any(ArrayBuffer),
            false,
        );
        expect(mockUIInstance.setPlaybackUI).toHaveBeenLastCalledWith(false);
        expect(mockVisualizerInstance.stopAutoTour).toHaveBeenCalled();
    });
});
