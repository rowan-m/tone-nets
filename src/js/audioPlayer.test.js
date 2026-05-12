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

            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(Tone.start).toHaveBeenCalled();
            expect(Tone.context.rawContext.resume).toHaveBeenCalled();
        });

        it('should setup the worklet, gain, synth and sequencer correctly', async () => {
            player.sf2Buffer = new ArrayBuffer(8);
            await player.initialize();

            expect(
                Tone.context.rawContext.audioWorklet.addModule,
            ).toHaveBeenCalledWith('mock-processor-url');
            expect(Tone.context.rawContext.createGain).toHaveBeenCalled();
            expect(player.synth).toBeDefined();
            expect(player.sequencer).toBeDefined();
            expect(player.synth.connect).toHaveBeenCalledWith(
                player.masterGain,
            );
            expect(
                player.synth.soundBankManager.addSoundBank,
            ).toHaveBeenCalledWith(player.sf2Buffer, 'default');

            // Verify event listeners
            expect(player.synth.eventHandler.addEvent).toHaveBeenCalledWith(
                'noteOn',
                'viz-play',
                expect.any(Function),
            );
            expect(player.synth.eventHandler.addEvent).toHaveBeenCalledWith(
                'noteOff',
                'viz-release',
                expect.any(Function),
            );
            expect(player.sequencer.eventHandler.addEvent).toHaveBeenCalledWith(
                'songEnded',
                'viz-stop',
                expect.any(Function),
            );
        });
    });

    describe('Playback', () => {
        it('should load MIDI and play via sequencer', async () => {
            const dummyBuffer = new ArrayBuffer(8);
            await player.play(dummyBuffer);

            expect(player.sequencer.loadNewSongList).toHaveBeenCalledWith([
                { binary: dummyBuffer },
            ]);
            expect(player.sequencer.play).toHaveBeenCalled();
            expect(player.sequencer.loopCount).toBe(-1);
            expect(player.isPlaying).toBe(true);
            expect(mockAudioInstance.play).toHaveBeenCalled();

            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('playing');
                expect(
                    navigator.mediaSession.setPositionState,
                ).toHaveBeenCalled();
            }
        });

        it('should invoke onNotePlay and onNoteRelease via synth events', async () => {
            await player.initialize();

            const playCb = vi.fn();
            const releaseCb = vi.fn();
            player.onNotePlay = playCb;
            player.onNoteRelease = releaseCb;

            // Trigger noteOn event for C4
            const noteOnHandler =
                player.synth.eventHandler.addEvent.mock.calls.find(
                    (call) => call[0] === 'noteOn',
                )[2];
            noteOnHandler({ channel: 0, midiNote: 60, velocity: 100 });

            expect(playCb).toHaveBeenCalledWith('C4', undefined, 0, false);

            // Trigger noteOn event for E4 (C4 is now the previous note)
            noteOnHandler({ channel: 0, midiNote: 64, velocity: 100 });
            expect(playCb).toHaveBeenCalledWith('E4', 'C4', 0, false);

            // Trigger noteOff event for E4
            const noteOffHandler =
                player.synth.eventHandler.addEvent.mock.calls.find(
                    (call) => call[0] === 'noteOff',
                )[2];
            noteOffHandler({ channel: 0, midiNote: 64 });

            // It should be released with 'C4' as prevNoteName, not 'E4'
            expect(releaseCb).toHaveBeenCalledWith('E4', 'C4');
        });

        it('should update channel instruments via programChange events', async () => {
            await player.initialize();

            const pcHandler =
                player.synth.eventHandler.addEvent.mock.calls.find(
                    (call) => call[0] === 'programChange',
                )[2];

            pcHandler({ channel: 3, program: 25 });
            expect(player.channelInstruments[3]).toBe(25);
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

        it('should stop playback correctly', () => {
            player.stop();
            expect(player.sequencer.pause).toHaveBeenCalled();
            expect(player.sequencer.currentTime).toBe(0);
            expect(player.synth.stopAll).toHaveBeenCalled();
            expect(player.isPlaying).toBe(false);
            if ('mediaSession' in navigator) {
                expect(navigator.mediaSession.playbackState).toBe('none');
            }
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
