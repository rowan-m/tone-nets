import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MidiPlayer } from './audioPlayer.js';
import * as Tone from 'tone';

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

vi.mock('@tonejs/midi', () => {
    return {
        Midi: vi.fn().mockImplementation(function () {
            return {
                duration: 10,
                tracks: [
                    {
                        channel: 0,
                        instrument: { number: 1 },
                        controlChanges: {
                            7: [{ time: 0, value: 0.8 }], // Volume
                            0: [{ time: 0, value: 121 }], // Bank Select MSB
                        },
                        pitchBends: [{ time: 1, value: 0.5 }],
                        notes: [
                            {
                                time: 2,
                                duration: 1,
                                midi: 60,
                                velocity: 0.8,
                                name: 'C4',
                            },
                            {
                                time: 4,
                                duration: 1,
                                midi: 62,
                                velocity: 0.8,
                                name: 'D4',
                            },
                        ],
                    },
                    {
                        channel: 9, // Drums
                        instrument: { number: 0 },
                        controlChanges: {},
                        pitchBends: [],
                        notes: [
                            {
                                time: 2,
                                duration: 0.1,
                                midi: 36,
                                velocity: 1.0,
                                name: 'C2',
                            },
                        ],
                    },
                ],
            };
        }),
    };
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
            connect: vi.fn(),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
            controllerChange: vi.fn(),
            programChange: vi.fn(),
            pitchWheel: vi.fn(),
            stopAll: vi.fn(),
        };
    });
    return { WorkletSynthesizer };
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
        state: 'running', // Or 'suspended'
        resume: vi.fn().mockResolvedValue(),
        audioWorklet: mockAudioWorklet,
        createGain: vi.fn().mockReturnValue(mockGainNode),
        destination: mockDestination,
    };

    let eventCounter = 0;
    return {
        Transport: {
            schedule: vi.fn(() => {
                // We return a mock event ID
                return `event-${eventCounter++}`;
            }),
            clear: vi.fn(),
            cancel: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            loop: false,
            loopStart: 0,
            loopEnd: 0,
            position: 0,
            seconds: 0,
            playbackRate: 1,
        },
        Draw: {
            schedule: vi.fn(),
            cancel: vi.fn(),
        },
        context: {
            state: 'running',
            currentTime: 0,
            rawContext: mockRawContext,
        },
        start: vi.fn().mockResolvedValue(),
    };
});

describe('MidiPlayer', () => {
    let player;

    beforeEach(() => {
        vi.clearAllMocks();
        Tone.context.state = 'running';
        Tone.context.rawContext.state = 'running';
        player = new MidiPlayer();
    });

    afterEach(() => {
        player.stop();
        if (player._resetTimeout) {
            clearTimeout(player._resetTimeout);
        }
    });

    describe('Initialization', () => {
        it('should load soundfont successfully', async () => {
            await player.loadSoundfont('/custom-font.sf2');
            expect(global.fetch).toHaveBeenCalledWith('/custom-font.sf2');
            expect(player.sf2Buffer).toBeInstanceOf(ArrayBuffer);
        });

        it('should throw an error if soundfont fails to load', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Not Found',
            });
            await expect(player.loadSoundfont()).rejects.toThrow(
                'Failed to load soundfont: Not Found',
            );
        });

        it('should start Tone.context and rawContext if suspended during init', async () => {
            Tone.context.state = 'suspended';
            Tone.context.rawContext.state = 'suspended';

            // Provide a dummy buffer to skip fetch in init
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(Tone.start).toHaveBeenCalled();
            expect(Tone.context.rawContext.resume).toHaveBeenCalled();
        });

        it('should setup the worklet, gain, and synth correctly', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(
                Tone.context.rawContext.audioWorklet.addModule,
            ).toHaveBeenCalledWith('mock-processor-url');
            expect(Tone.context.rawContext.createGain).toHaveBeenCalled();
            expect(player.synth).toBeDefined();
            expect(player.masterGain).toBeDefined();
            expect(player.synth.connect).toHaveBeenCalledWith(
                player.masterGain,
            );
            expect(
                player.synth.soundBankManager.addSoundBank,
            ).toHaveBeenCalledWith(player.sf2Buffer, 'default');
        });

        it('should not re-initialize if synth already exists', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();
            const firstSynth = player.synth;

            await player.initialize();
            expect(player.synth).toBe(firstSynth);
            expect(
                Tone.context.rawContext.audioWorklet.addModule,
            ).toHaveBeenCalledTimes(1);
        });
    });

    describe('Playback', () => {
        it('should schedule control changes, program changes, pitch bends, and notes on play', async () => {
            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);

            // Verify Tone.Transport.schedule was called many times
            // 2 CCs (Vol, Bank), 1 PC, 1 PB, 4 Notes (2 Play, 2 Release) for Channel 0
            // 2 Notes (1 Play, 1 Release) for Channel 9
            // Total = 10 schedule calls minimum
            expect(
                Tone.Transport.schedule.mock.calls.length,
            ).toBeGreaterThanOrEqual(10);

            // Verify transport configuration
            expect(Tone.Transport.loop).toBe(true);
            expect(Tone.Transport.loopStart).toBe(0);
            expect(Tone.Transport.position).toBe(0);
            expect(Tone.Transport.start).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
            expect(mockAudioInstance.play).toHaveBeenCalled();

            // Verify Media Session
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('playing');
                expect(
                    navigator.mediaSession.setPositionState,
                ).toHaveBeenCalled();
            }
        });

        it('should handle instrument without number safely', async () => {
            const { Midi } = await import('@tonejs/midi');
            Midi.mockImplementationOnce(function () {
                return {
                    duration: 5,
                    tracks: [
                        {
                            channel: 0,
                            instrument: {}, // No number
                            controlChanges: {},
                            pitchBends: [],
                            notes: [],
                        },
                    ],
                };
            });

            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);
            expect(player.channelInstruments[0]).toBe(0);
            expect(player.isPlaying).toBe(true);
        });

        it('should handle empty MIDI tracks safely', async () => {
            const { Midi } = await import('@tonejs/midi');
            Midi.mockImplementationOnce(function () {
                return {
                    duration: 0,
                    tracks: [],
                };
            });

            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);
            expect(player.isPlaying).toBe(true);
            expect(Tone.Transport.start).toHaveBeenCalled();
        });

        it('should not crash if dummy audio play fails', async () => {
            mockAudioInstance.play.mockRejectedValueOnce(
                new Error('Autoplay prevented'),
            );
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);

            expect(player.isPlaying).toBe(true);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Dummy audio play failed'),
                expect.any(Error),
            );
            consoleSpy.mockRestore();
        });

        it('should populate scheduledEvents array to allow for cleanup later', async () => {
            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);
            expect(player.scheduledEvents.length).toBeGreaterThan(0);
        });

        it('should invoke onNotePlay and onNoteRelease callbacks via Tone.Draw', () => {
            // Setup callbacks
            const playCb = vi.fn();
            const releaseCb = vi.fn();
            player.onNotePlay = playCb;
            player.onNoteRelease = releaseCb;

            // Create a dummy synth manually to bypass async init for this specific synchronous test
            player.synth = {
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                controllerChange: vi.fn(),
                pitchWheel: vi.fn(),
            };
            player.channelInstruments[0] = 5;

            // Isolate Tone.Draw behavior
            Tone.Draw.schedule.mockImplementationOnce((cb) => cb());

            // Schedule Play
            const noteObj = {
                time: 1,
                midi: 60,
                velocity: 0.8,
                name: 'C4',
                duration: 1,
            };
            const prevNoteObj = { name: 'B3' };
            player._scheduleNotePlay(0, noteObj, prevNoteObj, 0);

            // Extract the callback passed to Transport.schedule
            const transportCb = Tone.Transport.schedule.mock.calls.find(
                (call) => call[1] === 1,
            )[0];
            transportCb(1); // Execute it

            expect(player.synth.noteOn).toHaveBeenCalledWith(
                0,
                60,
                Math.round(0.8 * 127),
                { time: 1 },
            );
            expect(playCb).toHaveBeenCalledWith('C4', 'B3', 5, false);

            // Test Drums flag
            Tone.Draw.schedule.mockImplementationOnce((cb) => cb());
            player._scheduleNotePlay(9, noteObj, null, 0);
            const transportCb2 =
                Tone.Transport.schedule.mock.calls[
                    Tone.Transport.schedule.mock.calls.length - 1
                ][0];
            transportCb2(2);
            expect(playCb).toHaveBeenCalledWith('C4', null, 0, true);
        });
    });

    describe('Control flow (Pause, Resume, Stop)', () => {
        beforeEach(async () => {
            player.synth = {
                stopAll: vi.fn(),
                noteOff: vi.fn(),
                controllerChange: vi.fn(),
                pitchWheel: vi.fn(),
            };
            player.masterGain = {
                gain: {
                    setTargetAtTime: vi.fn(),
                },
            };
            player.scheduledEvents = ['event-1', 'event-2'];
            player.isPlaying = true;
        });

        it('should pause playback correctly', () => {
            player.pause();
            expect(Tone.Transport.pause).toHaveBeenCalled();
            expect(mockAudioInstance.pause).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('paused');
            }
        });

        it('should resume playback correctly', () => {
            player.isPlaying = false;
            player.resume();
            expect(Tone.Transport.start).toHaveBeenCalled();
            expect(mockAudioInstance.play).toHaveBeenCalled();
            expect(player.isPlaying).toBe(true);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('playing');
            }
        });

        it('should stop playback correctly', () => {
            player.stop();
            expect(Tone.Transport.stop).toHaveBeenCalled();
            expect(Tone.Transport.cancel).toHaveBeenCalled();
            expect(Tone.Draw.cancel).toHaveBeenCalled();
            expect(player.synth.stopAll).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            expect(player.scheduledEvents.length).toBe(0);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('none');
            }
        });

        it('should handle stop when synth is not initialized', () => {
            player.synth = null;
            expect(() => player.stop()).not.toThrow();
        });
    });

    describe('Control Change scheduling edge cases', () => {
        it('should schedule Bank Select MSB/LSB at exactly time 0 if present at time 0', () => {
            const ccZero = { time: 0, value: 1 };
            // startDelay is 0.5
            player._scheduleControlChange(0, '0', ccZero, 0.5);
            // Verify scheduleTime was 0, not 0.5
            expect(Tone.Transport.schedule).toHaveBeenCalledWith(
                expect.any(Function),
                0,
            );

            Tone.Transport.schedule.mockClear();

            player._scheduleControlChange(0, '32', ccZero, 0.5); // Bank Select LSB
            expect(Tone.Transport.schedule).toHaveBeenCalledWith(
                expect.any(Function),
                0,
            );

            Tone.Transport.schedule.mockClear();

            const ccOther = { time: 0, value: 1 };
            player._scheduleControlChange(0, '7', ccOther, 0.5); // Volume
            // Verify scheduleTime was 0.5
            expect(Tone.Transport.schedule).toHaveBeenCalledWith(
                expect.any(Function),
                0.5,
            );
        });
    });

    describe('Hard Reset Detail', () => {
        it('should call all expected controllers during hard reset', () => {
            player.synth = {
                controllerChange: vi.fn(),
                pitchWheel: vi.fn(),
            };

            player._hardResetSynth();

            // 16 channels, 4 CCs each (120, 123, 64, 121) = 64 calls
            expect(player.synth.controllerChange).toHaveBeenCalledTimes(16 * 4);
            expect(player.synth.pitchWheel).toHaveBeenCalledTimes(16);

            // Verify specific CCs
            expect(player.synth.controllerChange).toHaveBeenCalledWith(
                0,
                120,
                0,
            ); // All Sound Off
            expect(player.synth.controllerChange).toHaveBeenCalledWith(
                0,
                123,
                0,
            ); // All Notes Off
            expect(player.synth.controllerChange).toHaveBeenCalledWith(
                0,
                64,
                0,
            ); // Sustain Off
            expect(player.synth.controllerChange).toHaveBeenCalledWith(
                0,
                121,
                0,
            ); // Reset All
            expect(player.synth.pitchWheel).toHaveBeenCalledWith(0, 8192); // Pitch Center
        });
    });
});
