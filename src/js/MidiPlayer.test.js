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
            loadNewSongList: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            currentTime: 0,
            duration: 10,
            playbackRate: 1,
            loopCount: 0,
            eventHandler: {
                addEvent: vi.fn((name, id, cb) => {
                    sequencerEvents[name] = cb;
                }),
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
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn(),
        },
    };

    const mockRawContext = {
        state: 'running',
        resume: vi.fn().mockResolvedValue(),
        audioWorklet: mockAudioWorklet,
        createGain: vi.fn().mockReturnValue(mockGainNode),
        destination: mockDestination,
        createMediaStreamDestination: vi.fn().mockReturnValue({
            stream: {},
        }),
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
        for (const key in synthEvents) delete synthEvents[key];
        for (const key in sequencerEvents) delete sequencerEvents[key];
        player = new MidiPlayer();
    });

    describe('Initialization', () => {
        it('should load soundfont and set buffer', async () => {
            await player.loadSoundfont();
            expect(player.sf2Buffer).toBeDefined();
            expect(player.sf2Buffer.byteLength).toBe(8);
        });

        it('should throw error if soundfont fails to load', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Not Found',
            });
            await expect(player.loadSoundfont()).rejects.toThrow(
                'Failed to load soundfont: Not Found',
            );
        });

        it('should initialize synth and sequencer when valid buffer is present', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            expect(player.synth).toBeDefined();
            expect(player.sequencer).toBeDefined();
        });

        it('should resume raw context if suspended', async () => {
            const { context } = await import('tone');
            context.rawContext.state = 'suspended';
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            expect(context.rawContext.resume).toHaveBeenCalled();
            context.rawContext.state = 'running';
        });

        it('should apply mobile-specific optimizations when on mobile', async () => {
            vi.spyOn(Utils, 'isMobile').mockReturnValue(true);
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(player.synth.setSystemParameter).toHaveBeenCalledWith(
                'voiceCap',
                64,
            );
            expect(player.synth.setSystemParameter).toHaveBeenCalledWith(
                'autoAllocateVoices',
                false,
            );
            expect(player.synth.setSystemParameter).toHaveBeenCalledWith(
                'interpolationType',
                0,
            );
            expect(mockAudioInstance.setAttribute).toHaveBeenCalledWith(
                'playsinline',
                '',
            );
        });

        it('should handle synth events and trigger callbacks', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            const onNotePlay = vi.fn();
            const onNoteRelease = vi.fn();
            player.onNotePlay = onNotePlay;
            player.onNoteRelease = onNoteRelease;
            await player.initialize();

            // Note On
            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            expect(onNotePlay).toHaveBeenCalledWith('C4', undefined, 0, false);

            // Note Off
            synthEvents['noteOff']({ midiNote: 60, channel: 0 });
            expect(onNoteRelease).toHaveBeenCalledWith('C4', undefined);
        });

        it('should handle multiple note events on same channel with activeNotes stack', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            synthEvents['noteOn']({ midiNote: 64, channel: 0 });

            expect(player.lastNotePerChannel.get(0)).toBe('E4');
            const noteKeyE = '0-64';
            expect(player.activeNotes.get(noteKeyE)).toEqual(['C4']);
        });
    });

    describe('Playback Control', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
        });

        it('should start playback and update state when autoplay is true', async () => {
            await player.play(new ArrayBuffer(8), true);
            expect(player.isPlaying).toBe(true);
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(mockAudioInstance.play).toHaveBeenCalled();
        });

        it('should NOT start playback but load MIDI when autoplay is false', async () => {
            await player.play(new ArrayBuffer(8), false);
            expect(player.isPlaying).toBe(false);
            expect(player.sequencer.play).not.toHaveBeenCalled();
            expect(player.sequencer.pause).toHaveBeenCalled();
        });

        it('should handle songEnded and restart if looping is enabled', () => {
            player.isPlaying = true;
            player.isLooping = true;
            const stopAllSpy = vi.spyOn(player, '_hardResetSynth');

            sequencerEvents['songEnded']();

            expect(player.sequencer.currentTime).toBe(0);
            expect(stopAllSpy).toHaveBeenCalled();
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
        });

        it('should handle songEnded and stop if looping is disabled', () => {
            player.isPlaying = true;
            player.isLooping = false;

            sequencerEvents['songEnded']();

            expect(player.isPlaying).toBe(false);
            expect(mockAudioInstance.pause).toHaveBeenCalled();
        });

        it('should handle dummy audio play failure gracefully', async () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockAudioInstance.play.mockRejectedValueOnce(
                new Error('Audio Fail'),
            );

            await player.play(new ArrayBuffer(8), true);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(consoleSpy).toHaveBeenCalledWith(
                'Dummy audio play failed:',
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });
    });

    describe('MediaSession', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
        });

        it('should update MediaSession position state', () => {
            player.sequencer.duration = 42;
            player.sequencer.currentTime = 10;
            player.updateMediaSessionPosition();

            expect(
                navigator.mediaSession.setPositionState,
            ).toHaveBeenCalledWith({
                duration: 42,
                playbackRate: 1,
                position: 10,
            });
        });

        it('should handle missing MediaSession gracefully', () => {
            const originalMediaSession = navigator.mediaSession;
            delete navigator.mediaSession;
            expect(() => player.updateMediaSessionPosition()).not.toThrow();
            Object.defineProperty(global.navigator, 'mediaSession', {
                value: originalMediaSession,
                writable: true,
                configurable: true,
            });
        });

        it('should log warning if setPositionState throws', () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            vi.spyOn(
                navigator.mediaSession,
                'setPositionState',
            ).mockImplementationOnce(() => {
                throw new Error('Fail');
            });

            player.sequencer.duration = 42;
            player.updateMediaSessionPosition();

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('Controls', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            player.isPlaying = true;
        });

        it('should pause and reset synth after timeout', () => {
            vi.useFakeTimers();
            player.pause();
            expect(player.isPlaying).toBe(false);
            expect(player.sequencer.pause).toHaveBeenCalled();

            vi.advanceTimersByTime(200);
            expect(player.synth.stopAll).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('should resume from paused state', () => {
            player.isPlaying = false;
            player.resume();
            expect(player.isPlaying).toBe(true);
            expect(player.sequencer.play).toHaveBeenCalled();
        });

        it('should stop and reset tracking', () => {
            player.lastNotePerChannel.set(0, 'C4');
            player.stop();
            expect(player.isPlaying).toBe(false);
            expect(player.lastNotePerChannel.size).toBe(0);
        });

        it('should restart from beginning', () => {
            player.sequencer.currentTime = 10;
            player.restart();
            expect(player.sequencer.currentTime).toBe(0);
        });

        it('should clear existing resetTimeout', () => {
            vi.useFakeTimers();
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            player._resetTimeout = setTimeout(() => {}, 1000);
            player.stop();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
            vi.useRealTimers();
        });
    });

    describe('Hard Reset', () => {
        it('should reset all controllers and pitch wheel', () => {
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
