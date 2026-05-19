import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MidiPlayer } from './MidiPlayer.js';

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

        it('should load soundfont and initialize synth', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(player.synth).toBeDefined();
            expect(player.sequencer).toBeDefined();
            expect(player.sf2Buffer).toBeDefined();
        });

        it('should resume raw context if suspended', async () => {
            const { context } = await import('tone');
            context.rawContext.state = 'suspended';
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            expect(context.rawContext.resume).toHaveBeenCalled();
            context.rawContext.state = 'running'; // Reset for other tests
        });

        it('should fetch soundfont if buffer is missing', async () => {
            const loadSpy = vi
                .spyOn(player, 'loadSoundfont')
                .mockResolvedValue();
            await player.initialize();
            expect(loadSpy).toHaveBeenCalled();
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

        it('should not re-initialize if synth already exists', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            const firstSynth = player.synth;

            await player.initialize();
            expect(player.synth).toBe(firstSynth);
        });

        it('should handle synth events correctly', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            const onNotePlay = vi.fn();
            const onNoteRelease = vi.fn();
            player.onNotePlay = onNotePlay;
            player.onNoteRelease = onNoteRelease;

            await player.initialize();

            // Trigger noteOn
            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            expect(onNotePlay).toHaveBeenCalledWith('C4', undefined, 0, false);
            expect(player.lastNotePerChannel.get(0)).toBe('C4');

            // Trigger noteOff
            synthEvents['noteOff']({ midiNote: 60, channel: 0 });
            expect(onNoteRelease).toHaveBeenCalledWith('C4', undefined);

            // Trigger programChange
            synthEvents['programChange']({ channel: 1, program: 12 });
            expect(player.channelInstruments[1]).toBe(12);
        });

        it('should handle noteOff without matching noteOn', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            const onNoteRelease = vi.fn();
            player.onNoteRelease = onNoteRelease;
            await player.initialize();

            synthEvents['noteOff']({ midiNote: 60, channel: 0 });
            expect(onNoteRelease).toHaveBeenCalledWith('C4', undefined);
        });

        it('should handle drum channel correctly in noteOn', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            const onNotePlay = vi.fn();
            player.onNotePlay = onNotePlay;
            await player.initialize();

            synthEvents['noteOn']({ midiNote: 36, channel: 9 }); // Channel 10 is index 9
            expect(onNotePlay).toHaveBeenCalledWith('C2', undefined, 0, true);
        });

        it('should handle multiple note events on same channel', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            // Note On C4
            synthEvents['noteOn']({ midiNote: 60, channel: 0 });
            // Note On E4 (previous was C4)
            synthEvents['noteOn']({ midiNote: 64, channel: 0 });

            expect(player.lastNotePerChannel.get(0)).toBe('E4');

            // Check activeNotes stack
            const noteKeyE = '0-64';
            expect(player.activeNotes.get(noteKeyE)).toEqual(['C4']);
        });
    });

    describe('Looping', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
        });

        it('should loop by default', () => {
            expect(player.isLooping).toBe(true);
        });

        it('should restart playback on songEnded if isLooping is true', () => {
            player.isPlaying = true;
            player.isLooping = true;

            sequencerEvents['songEnded']();

            expect(player.sequencer.currentTime).toBe(0);
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
        });

        it('should NOT restart playback on songEnded if isLooping is false', () => {
            player.isPlaying = true;
            player.isLooping = false;

            sequencerEvents['songEnded']();

            expect(player.sequencer.play).not.toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            expect(mockAudioInstance.pause).toHaveBeenCalled();
        });
    });

    describe('Playback', () => {
        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
        });

        it('should start playback when play is called with autoplay=true', async () => {
            await player.play(new ArrayBuffer(8), true);

            expect(player.sequencer.loadNewSongList).toHaveBeenCalled();
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
            expect(mockAudioInstance.play).toHaveBeenCalled();
        });

        it('should handle dummy audio play failure in play()', async () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockAudioInstance.play.mockRejectedValueOnce(
                new Error('Audio Fail'),
            );

            await player.play(new ArrayBuffer(8), true);

            // Wait for promise microtasks
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(consoleSpy).toHaveBeenCalledWith(
                'Dummy audio play failed:',
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });

        it('should not start playback when play is called with autoplay=false', async () => {
            await player.play(new ArrayBuffer(8), false);

            expect(player.sequencer.play).not.toHaveBeenCalled();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
        });

        it('should stop existing playback when play is called', async () => {
            const stopSpy = vi.spyOn(player, 'stop');
            await player.play(new ArrayBuffer(8));
            expect(stopSpy).toHaveBeenCalled();
        });
    });

    describe('MediaSession', () => {
        it('should handle environments without MediaSession gracefully', async () => {
            const originalMediaSession = navigator.mediaSession;
            delete navigator.mediaSession; // simulate unsupported

            expect(() => player.updateMediaSessionPosition()).not.toThrow();

            // Should not throw during play, pause, stop either
            player.sequencer = {
                duration: 10,
                pause: vi.fn(),
                play: vi.fn(),
                loadNewSongList: vi.fn(),
            };
            player.masterGain = {
                gain: {
                    setTargetAtTime: vi.fn(),
                    cancelScheduledValues: vi.fn(),
                    setValueAtTime: vi.fn(),
                },
            };
            player.dummyAudio = mockAudioInstance;

            expect(() => player.stop()).not.toThrow();
            expect(() => player.pause()).not.toThrow();
            player.isPlaying = true;
            expect(() => player.resume()).not.toThrow();

            // Cover play() without media session
            await expect(
                player.play(new ArrayBuffer(8), true),
            ).resolves.not.toThrow();
            await expect(
                player.play(new ArrayBuffer(8), false),
            ).resolves.not.toThrow();

            // Restore
            Object.defineProperty(global.navigator, 'mediaSession', {
                value: originalMediaSession,
                writable: true,
                configurable: true,
            });
        });

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

        it('should update duration if difference is significant', () => {
            player.duration = 42;
            player.sequencer = {
                duration: 43,
                playbackRate: 1,
                currentTime: 10,
            };

            player.updateMediaSessionPosition();
            expect(player.duration).toBe(43);
        });

        it('should not update duration if difference is small', () => {
            player.duration = 42;
            player.sequencer = {
                duration: 42.05,
                playbackRate: 1,
                currentTime: 10,
            };

            player.updateMediaSessionPosition();
            expect(player.duration).toBe(42);
        });

        it('should update position state periodically when playing', () => {
            vi.useFakeTimers();
            player.sequencer = {
                duration: 100,
                playbackRate: 1,
                currentTime: 10,
            };
            player.isPlaying = true;
            const updateSpy = vi.spyOn(player, 'updateMediaSessionPosition');

            player._startMediaSessionInterval();

            vi.advanceTimersByTime(1000);
            expect(updateSpy).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1000);
            expect(updateSpy).toHaveBeenCalledTimes(2);

            player.isPlaying = false;
            vi.advanceTimersByTime(1000);
            expect(updateSpy).toHaveBeenCalledTimes(2); // Should have stopped

            vi.useRealTimers();
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

        it('should log a warning if setPositionState fails', () => {
            player.duration = 42;
            player.sequencer = {
                duration: 42,
                playbackRate: 1,
                currentTime: 10,
            };
            const mockError = new Error('Test Error');
            const setPositionStateSpy = vi
                .spyOn(navigator.mediaSession, 'setPositionState')
                .mockImplementation(() => {
                    throw mockError;
                });
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            player.updateMediaSessionPosition();

            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to set MediaSession position state:',
                mockError,
            );
            consoleSpy.mockRestore();
            setPositionStateSpy.mockRestore();
        });
    });

    describe('Control flow', () => {
        it('should handle calling stop, pause, and resume before initialization safely', () => {
            const uninitializedPlayer = new MidiPlayer();
            expect(() => uninitializedPlayer.stop()).not.toThrow();

            uninitializedPlayer.isPlaying = true; // force the first condition to pass
            expect(() => uninitializedPlayer.pause()).not.toThrow();

            uninitializedPlayer.isPlaying = false; // force condition for resume
            expect(() => uninitializedPlayer.resume()).not.toThrow();

            expect(() => uninitializedPlayer.restart()).not.toThrow();
        });

        beforeEach(async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            player.isPlaying = true;
        });

        it('should pause playback correctly', () => {
            vi.useFakeTimers();
            player.pause();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(mockAudioInstance.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);

            // Trigger timeout
            vi.advanceTimersByTime(150);
            expect(player.synth.stopAll).toHaveBeenCalled();

            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('paused');
            }
            vi.useRealTimers();
        });

        it('should not pause if not playing', () => {
            player.isPlaying = false;
            player.pause();
            expect(player.sequencer.pause).not.toHaveBeenCalled();
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

        it('should not resume if already playing', () => {
            player.isPlaying = true;
            player.resume();
            expect(player.sequencer.play).not.toHaveBeenCalled();
        });

        it('should handle dummy audio play failure in resume()', async () => {
            player.isPlaying = false;
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockAudioInstance.play.mockRejectedValueOnce(
                new Error('Audio Fail'),
            );

            player.resume();

            // Wait for promise microtasks
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(consoleSpy).toHaveBeenCalledWith(
                'Dummy audio play failed:',
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });

        it('should stop playback and reset state', () => {
            vi.useFakeTimers();
            const onStopCb = vi.fn();
            player.onStop = onStopCb;

            player.stop();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(player.sequencer.currentTime).toBe(0);
            expect(mockAudioInstance.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            expect(onStopCb).toHaveBeenCalled();

            // Trigger timeout
            vi.advanceTimersByTime(150);
            expect(player.synth.stopAll).toHaveBeenCalled();

            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('none');
            }
            vi.useRealTimers();
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

        it('should handle restart without sequencer', () => {
            player.sequencer = null;
            expect(() => player.restart()).not.toThrow();
        });
        it('should handle restarting without onStop callback', () => {
            player.onStop = null;
            player.isPlaying = true;
            player.restart();
            expect(player.sequencer.currentTime).toBe(0);
            expect(player.synth.stopAll).toHaveBeenCalled();
        });

        it('should clear existing resetTimeout on stop, pause, and resume', () => {
            vi.useFakeTimers();
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            // Set a dummy timeout to trigger the clear branch
            player._resetTimeout = setTimeout(() => {}, 1000);
            player.stop();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            // Should have cleared the previous one and set a new one

            clearTimeoutSpy.mockClear();
            player.isPlaying = true;
            player._resetTimeout = setTimeout(() => {}, 1000);
            player.pause();
            expect(clearTimeoutSpy).toHaveBeenCalled();

            clearTimeoutSpy.mockClear();
            player.isPlaying = false;
            player._resetTimeout = setTimeout(() => {}, 1000);
            player.resume();
            expect(clearTimeoutSpy).toHaveBeenCalled();

            clearTimeoutSpy.mockRestore();
            vi.useRealTimers();
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
