import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MidiPlayer } from './MidiPlayer.js';
import { Utils } from './Utils.js';

// --- Mocks ---

// Mock global Audio to prevent DOM/Browser errors
const mockAudioInstance = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    setAttribute: vi.fn(),
    style: {},
    loop: false,
    currentTime: 0,
};
global.Audio = vi.fn().mockImplementation(function () {
    return mockAudioInstance;
});

// Mock fetch for soundfont loading
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
});

// Mock mediaSession
Object.defineProperty(global.navigator, 'mediaSession', {
    value: {
        setPositionState: vi.fn(),
        playbackState: 'none',
    },
    writable: true,
    configurable: true,
});

// Helper to capture events
const synthEvents = {};
const sequencerEvents = {};

// We must mock processorUrl since it's an import with a query parameter (?url)
vi.mock('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => {
    return { default: 'mock-processor-url' };
});

vi.mock('spessasynth_lib', () => {
    const WorkletSynthesizer = vi.fn().mockImplementation(function () {
        return {
            isReady: Promise.resolve(),
            soundBankManager: {
                addSoundBank: vi.fn().mockResolvedValue(),
            },
            eventHandler: {
                addEvent: vi.fn((name, id, cb) => {
                    synthEvents[name] = cb;
                }),
            },
            connect: vi.fn(),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
            controllerChange: vi.fn(),
            programChange: vi.fn(),
            pitchWheel: vi.fn(),
            stopAll: vi.fn(),
            setSystemParameter: vi.fn(),
            getMasterParameter: vi.fn(),
        };
    });

    const Sequencer = vi.fn().mockImplementation(function () {
        return {
            loadNewSongList: vi.fn(function () {
                if (sequencerEvents['songChange']) {
                    setTimeout(() => {
                        if (sequencerEvents['songChange']) {
                            sequencerEvents['songChange']({ songIndex: 0 });
                        }
                    }, 0);
                }
            }),
            play: vi.fn(),
            pause: vi.fn(),
            currentTime: 0,
            duration: 10,
            playbackRate: 1,
            loopCount: 0,
            eventHandler: {
                addEvent: vi.fn((...args) => {
                    sequencerEvents[args[0]] = args[2];
                }),
                removeEvent: vi.fn((name) => {
                    delete sequencerEvents[name];
                }),
            },
        };
    });

    return { WorkletSynthesizer, Sequencer };
});

const mockAudioWorklet = {
    addModule: vi.fn().mockResolvedValue(),
};

const mockDestination = {};

const mockGainNode = {
    connect: vi.fn(),
    gain: {
        value: 0,
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
    },
};

const mockAnalyserNode = {
    connect: vi.fn(),
    getByteFrequencyData: vi.fn((array) => {
        for (let i = 0; i < array.length; i++) array[i] = 128;
    }),
    frequencyBinCount: 128,
    fftSize: 256,
};

let mockTime = 0;
const mockRawContext = {
    state: 'running',
    get currentTime() {
        return mockTime++;
    },
    resume: vi.fn().mockResolvedValue(),
    audioWorklet: mockAudioWorklet,
    createGain: vi.fn().mockReturnValue(mockGainNode),
    createAnalyser: vi.fn().mockReturnValue(mockAnalyserNode),
    destination: mockDestination,
    createMediaStreamDestination: vi.fn().mockReturnValue({
        stream: {},
    }),
};

mockGainNode.context = mockRawContext;

global.AudioContext = vi.fn().mockImplementation(function () {
    return mockRawContext;
});

describe('MidiPlayer', () => {
    let player;

    beforeEach(() => {
        vi.clearAllMocks();
        for (const key in synthEvents) delete synthEvents[key];
        for (const key in sequencerEvents) delete sequencerEvents[key];
        player = new MidiPlayer();
        // Speed up tests by bypassing stabilization delays
        vi.spyOn(player, '_delay').mockResolvedValue(undefined);
    });

    describe('Initialization', () => {
        it('should load soundfont and initialize synth and sequencer', async () => {
            await player.initialize();
            expect(player.sf2Buffer).toBeDefined();
            expect(player.synth).toBeDefined();
            expect(player.sequencer).toBeDefined();
            expect(player.audioContext).toBe(mockRawContext);
        });

        it('should throw error if soundfont fails to load', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Not Found',
            });
            await expect(player.initialize()).rejects.toThrow(
                'Failed to load soundfont: Not Found',
            );
        });

        it('should resume audio context if it starts suspended', async () => {
            mockRawContext.state = 'suspended';
            await player.initialize();
            expect(mockRawContext.resume).toHaveBeenCalled();
            mockRawContext.state = 'running';
        });

        it('should apply mobile optimizations and background audio routing on mobile devices', async () => {
            vi.spyOn(Utils, 'isMobile').mockReturnValue(true);
            await player.initialize();

            // Verify mobile-specific side effects (background audio setup)
            expect(mockAudioInstance.setAttribute).toHaveBeenCalledWith(
                'playsinline',
                '',
            );
            // Verify synth was configured (checking one param is enough to confirm the branch was taken)
            expect(player.synth.setSystemParameter).toHaveBeenCalled();
        });

        it('should trigger onNotePlay and onNoteRelease callbacks from synth events', async () => {
            const onNotePlay = vi.fn();
            const onNoteRelease = vi.fn();
            player.onNotePlay = onNotePlay;
            player.onNoteRelease = onNoteRelease;
            await player.initialize();

            // Simulate MIDI Note On
            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            expect(onNotePlay).toHaveBeenCalledWith('C4', undefined, 0, false);

            // Simulate MIDI Note Off
            synthEvents['noteOff']({ midiNote: 60, channel: 0 });
            expect(onNoteRelease).toHaveBeenCalledWith('C4', undefined);
        });

        it('should handle concurrent initialization by returning the same promise', async () => {
            const p1 = player.initialize();
            const p2 = player.initialize();
            expect(p1).toBe(p2);
            await p1;
        });

        it('should allow retry after a failed initialization', async () => {
            vi.spyOn(player, 'loadSoundfont').mockRejectedValueOnce(
                new Error('Load Fail'),
            );

            await expect(player.initialize()).rejects.toThrow('Load Fail');
            expect(player._initPromise).toBeNull();

            // Retry should succeed
            vi.spyOn(player, 'loadSoundfont').mockResolvedValueOnce();
            await player.initialize();
            expect(player.synth).toBeDefined();
        });
    });

    describe('Playback Control', () => {
        beforeEach(async () => {
            await player.initialize();
        });

        it('should start playback and update state when autoplay is enabled', async () => {
            await player.play(new ArrayBuffer(8), true);
            expect(player.isPlaying).toBe(true);
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(mockAudioInstance.play).toHaveBeenCalled();
        });

        it('should only load MIDI and NOT start playback when autoplay is disabled', async () => {
            await player.play(new ArrayBuffer(8), false);
            expect(player.isPlaying).toBe(false);
            expect(player.sequencer.play).not.toHaveBeenCalled();
            expect(player.sequencer.pause).toHaveBeenCalled();
        });

        it('should handle concurrent play calls by prioritizing the latest request', async () => {
            const buffer1 = new ArrayBuffer(8);
            const buffer2 = new ArrayBuffer(16);

            // Mock initialize to take some time to create a race condition
            const originalInit = player.initialize;
            player.initialize = vi.fn().mockImplementation(async () => {
                await new Promise((r) => setTimeout(r, 10));
                return originalInit.call(player);
            });

            const p1 = player.play(buffer1, true);
            const p2 = player.play(buffer2, true);

            await Promise.all([p1, p2]);

            // The sequencer should have loaded the second buffer
            expect(player.sequencer.loadNewSongList).toHaveBeenCalledWith([
                { binary: new Uint8Array(buffer2) },
            ]);
        });

        it('should loop playback and trigger onStop when song ends if isLooping is true', () => {
            const onStop = vi.fn();
            player.onStop = onStop;
            player.isPlaying = true;
            player.isLooping = true;

            sequencerEvents['songEnded']();

            expect(player.sequencer.currentTime).toBe(0);
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
            expect(onStop).toHaveBeenCalled();
        });

        it('should stop playback and reset tracking when song ends if isLooping is false', () => {
            let isPlayingDuringOnStop = true;
            player.onStop = vi.fn(() => {
                isPlayingDuringOnStop = player.isPlaying;
            });
            player.isPlaying = true;
            player.isLooping = false;

            sequencerEvents['songEnded']();

            expect(player.isPlaying).toBe(false);
            expect(player.onStop).toHaveBeenCalled();
            expect(isPlayingDuringOnStop).toBe(false);
            expect(mockAudioInstance.pause).toHaveBeenCalled();
        });

        it('should pause and resume playback correctly, cleaning up voices after a short delay', () => {
            vi.useFakeTimers();
            player.isPlaying = true;

            player.pause();
            expect(player.isPlaying).toBe(false);
            expect(player.sequencer.pause).toHaveBeenCalled();

            // Should trigger hard reset after delay
            vi.advanceTimersByTime(200);
            expect(player.synth.stopAll).toHaveBeenCalled();

            player.resume();
            expect(player.isPlaying).toBe(true);
            expect(player.sequencer.play).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('should track note transitions correctly for overlapping notes (chords)', async () => {
            const onNotePlay = vi.fn();
            player.onNotePlay = onNotePlay;
            await player.initialize();

            // Note On C4
            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            expect(onNotePlay).toHaveBeenLastCalledWith(
                'C4',
                undefined,
                0,
                false,
            );

            // Note On E4 (while C4 is still "active" in terms of transition tracking)
            synthEvents['noteOn']({ midiNote: 64, channel: 0 });
            expect(onNotePlay).toHaveBeenLastCalledWith('E4', 'C4', 0, false);

            // The system should track that C4 was the predecessor for E4 even if they started closely
        });

        it('should handle dummy audio play failure gracefully', async () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockAudioInstance.play.mockRejectedValueOnce(
                new Error('Audio Blocked'),
            );

            await player.play(new ArrayBuffer(8), true);

            // Wait for microtask queue to process the catch block
            await new Promise((r) => setTimeout(r, 0));

            expect(consoleSpy).toHaveBeenCalledWith(
                'Dummy audio play failed:',
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });

        it('should stop, reset tracking state, and trigger onStop', () => {
            vi.useFakeTimers();
            const onStop = vi.fn();
            player.onStop = onStop;
            player.isPlaying = true;
            player.lastNotePerChannel.set(0, 'C4');

            player.stop();

            expect(player.isPlaying).toBe(false);
            expect(player.lastNotePerChannel.size).toBe(0);
            expect(onStop).toHaveBeenCalled();

            // Cleanup timeout
            vi.advanceTimersByTime(200);
            expect(player.synth.stopAll).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('should restart from the beginning and trigger onStop', () => {
            const onStop = vi.fn();
            player.onStop = onStop;
            player.sequencer.currentTime = 10;

            player.restart();

            expect(player.sequencer.currentTime).toBe(0);
            expect(onStop).toHaveBeenCalled();
        });
    });

    describe('MediaSession Integration', () => {
        beforeEach(async () => {
            await player.initialize();
        });

        it('should update MediaSession position state accurately', () => {
            player.sequencer.duration = 100;
            player.sequencer.currentTime = 25;
            player.updateMediaSessionPosition();

            expect(
                navigator.mediaSession.setPositionState,
            ).toHaveBeenCalledWith({
                duration: 100,
                playbackRate: 1,
                position: 25,
            });
        });

        it('should log warning if MediaSession setPositionState throws', () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            vi.spyOn(
                navigator.mediaSession,
                'setPositionState',
            ).mockImplementationOnce(() => {
                throw new Error('Unsupported');
            });

            player.sequencer.duration = 10;
            player.updateMediaSessionPosition();

            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to set MediaSession position state:',
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });

        it('should periodically update position during active playback', () => {
            vi.useFakeTimers();
            player.isPlaying = true;

            player._startMediaSessionInterval();

            vi.advanceTimersByTime(1000);
            expect(navigator.mediaSession.setPositionState).toHaveBeenCalled();

            player.isPlaying = false;
            vi.advanceTimersByTime(1000);

            // Should have stopped ticking after isPlaying became false
            expect(player._mediaSessionInterval).toBeNull();
            vi.useRealTimers();
        });

        it('should handle environment without MediaSession support gracefully', () => {
            const originalMediaSession = navigator.mediaSession;
            // @ts-ignore
            delete navigator.mediaSession;

            expect(() => player.updateMediaSessionPosition()).not.toThrow();

            // Restore for other tests
            Object.defineProperty(global.navigator, 'mediaSession', {
                value: originalMediaSession,
                writable: true,
                configurable: true,
            });
        });
    });

    describe('Synthesis Events', () => {
        it('should update instrument tracking on programChange events', async () => {
            await player.initialize();
            synthEvents['programChange']({ channel: 1, program: 12 });
            expect(player.channelInstruments[1]).toBe(12);
        });

        it('should return frequency data from the analyser and reuse the same buffer', async () => {
            expect(player.getFrequencyData()).toBeNull();

            await player.initialize();
            const data1 = player.getFrequencyData();
            expect(data1).toBeInstanceOf(Uint8Array);
            expect(data1).toHaveLength(128);
            expect(data1[0]).toBe(128);

            const data2 = player.getFrequencyData();
            expect(data2).toBe(data1);
        });
    });
});
