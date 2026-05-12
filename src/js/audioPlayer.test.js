import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MidiPlayer } from './audioPlayer.js';

// --- Mocks ---

// Mock global Audio to prevent DOM/Browser errors
const mockAudioInstance = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
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
});

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
                addEvent: vi.fn(),
            },
            connect: vi.fn(),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
            controllerChange: vi.fn(),
            programChange: vi.fn(),
            pitchWheel: vi.fn(),
            stopAll: vi.fn(),
        };
    });

    const Sequencer = vi.fn().mockImplementation(function () {
        return {
            loadNewSongList: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            currentTime: 0,
            duration: 10,
            playbackRate: 1,
            loopCount: 0,
            eventHandler: {
                addEvent: vi.fn(),
            },
        };
    });

    return { WorkletSynthesizer, Sequencer };
});

vi.mock('tone', () => {
    const mockAudioWorklet = {
        addModule: vi.fn().mockResolvedValue(),
    };

    const mockDestination = {};

    const mockGainNode = {
        connect: vi.fn(),
        gain: {
            setTargetAtTime: vi.fn(),
        },
    };

    const mockRawContext = {
        state: 'running',
        resume: vi.fn().mockResolvedValue(),
        audioWorklet: mockAudioWorklet,
        createGain: vi.fn().mockReturnValue(mockGainNode),
        destination: mockDestination,
    };

    return {
        context: {
            state: 'suspended',
            currentTime: 0,
            start: vi.fn().mockResolvedValue(),
            rawContext: mockRawContext,
        },
        start: vi.fn().mockResolvedValue(),
    };
});

describe('MidiPlayer', () => {
    let player;

    beforeEach(() => {
        vi.clearAllMocks();
        player = new MidiPlayer();
    });

    describe('Initialization', () => {
        it('should load soundfont and initialize synth', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(player.synth).toBeDefined();
            expect(player.sequencer).toBeDefined();
            expect(player.sf2Buffer).toBeDefined();
        });

        it('should not re-initialize if synth already exists', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            const firstSynth = player.synth;

            await player.initialize();
            expect(player.synth).toBe(firstSynth);
        });
    });

    describe('MediaSession', () => {
        it('should update MediaSession position and refresh duration from sequencer', async () => {
            player.duration = 0;
            player.sequencer = {
                duration: 42,
                playbackRate: 1,
                currentTime: 10,
            };

            player.updateMediaSessionPosition();

            expect(player.duration).toBe(42);
            if ('mediaSession' in navigator) {
                expect(
                    navigator.mediaSession.setPositionState,
                ).toHaveBeenCalledWith({
                    duration: 42,
                    playbackRate: 1,
                    position: 10,
                });
            }
        });

        it('should not overwrite duration with 0 if sequencer duration is not yet available', () => {
            player.duration = 120; // Set by worker
            player.sequencer = {
                duration: 0,
                playbackRate: 1,
                currentTime: 0,
            };

            player.updateMediaSessionPosition();

            expect(player.duration).toBe(120);
        });

        it('should handle missing sequencer gracefully', () => {
            player.duration = 120;
            player.sequencer = null;

            // Should not throw
            player.updateMediaSessionPosition();
            expect(player.duration).toBe(120);
        });

        it('should not overwrite existing duration with 0 during play if sequencer is not ready', async () => {
            player.duration = 120;
            player.sequencer = {
                loadNewSongList: vi.fn(),
                duration: 0,
                play: vi.fn(),
                pause: vi.fn(),
                currentTime: 0,
                playbackRate: 1,
                eventHandler: { addEvent: vi.fn() },
            };
            // Mock initialize to not change sequencer
            vi.spyOn(player, 'initialize').mockImplementation(async () => {});

            await player.play(new ArrayBuffer(8));

            expect(player.duration).toBe(120);
        });
    });

    describe('Control flow', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            player.isPlaying = true;
        });

        it('should pause playback correctly', () => {
            player.pause();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(mockAudioInstance.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('paused');
            }
        });

        it('should resume playback correctly', () => {
            player.isPlaying = false;
            player.resume();
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(mockAudioInstance.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('playing');
            }
        });

        it('should stop playback and reset state', () => {
            player.stop();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(player.sequencer.currentTime).toBe(0);
            expect(mockAudioInstance.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('none');
            }
        });

        it('should restart playback', () => {
            const onStopCb = vi.fn();
            player.onStop = onStopCb;
            player.isPlaying = true;

            player.restart();

            expect(player.sequencer.currentTime).toBe(0);
            expect(player.synth.stopAll).toHaveBeenCalled();
            expect(onStopCb).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true); // Should maintain playing state
        });
    });

    describe('Hard Reset', () => {
        it('should call all expected controllers during hard reset', () => {
            player.synth = {
                stopAll: vi.fn(),
                controllerChange: vi.fn(),
                pitchWheel: vi.fn(),
            };

            player._hardResetSynth();

            expect(player.synth.stopAll).toHaveBeenCalled();
            expect(player.synth.controllerChange).toHaveBeenCalledTimes(16 * 4);
            expect(player.synth.pitchWheel).toHaveBeenCalledTimes(16);
        });
    });
});
