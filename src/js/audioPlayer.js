import * as Tone from 'tone';
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { midiNoteToName } from './utils.js';

export class MidiPlayer {
    constructor() {
        this.synth = null;
        this.sequencer = null;
        this.sf2Buffer = null;
        this.isPlaying = false;
        this.masterGain = null;
        this.channelInstruments = new Array(16).fill(0);
        this.lastNotePerChannel = new Map();
        this.activeNotes = new Map();
        this.duration = 0;

        this.dummyAudio = new Audio('/background.mp3');
        this.dummyAudio.loop = true;

        // Hooks for visualization
        this.onNotePlay = null;
        this.onNoteRelease = null;
        this.onStop = null;
    }

    async loadSoundfont(url = '/creative-emu10k1-8mbgmsfx.sf2') {
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Failed to load soundfont: ${response.statusText}`);
        this.sf2Buffer = await response.arrayBuffer();
    }

    async initialize() {
        // If we haven't fetched the buffer yet, do it now
        if (!this.sf2Buffer) {
            await this.loadSoundfont();
        }

        // Only create the synth once the user has interacted
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        if (!this.synth) {
            // Use Tone's underlying native AudioContext so all scheduled times align perfectly
            const rawCtx =
                Tone.context.rawContext._nativeContext ||
                Tone.context.rawContext;
            if (rawCtx.state === 'suspended') {
                await rawCtx.resume();
            }

            // Register the AudioWorklet processor BEFORE creating the synthesizer
            await rawCtx.audioWorklet.addModule(processorUrl);

            // Create master gain for muting/pausing
            this.masterGain = rawCtx.createGain();
            this.masterGain.connect(rawCtx.destination);

            // Initialize SpessaSynth
            this.synth = new WorkletSynthesizer(rawCtx);

            // Connect synthesizer to master gain
            this.synth.connect(this.masterGain);

            // Wait for worklet to be ready
            await this.synth.isReady;

            // Load the SoundFont
            await this.synth.soundBankManager.addSoundBank(
                this.sf2Buffer,
                'default',
            );

            // Initialize Sequencer
            this.sequencer = new Sequencer(this.synth);

            // Setup Synth Events for visualization
            this.synth.eventHandler.addEvent('noteOn', 'viz-play', (data) => {
                const noteName = midiNoteToName(data.midiNote);
                const prevNoteName = this.lastNotePerChannel.get(data.channel);
                this.lastNotePerChannel.set(data.channel, noteName);

                // Store prevNoteName for this specific note instance
                const noteKey = `${data.channel}-${data.midiNote}`;
                if (!this.activeNotes.has(noteKey)) {
                    this.activeNotes.set(noteKey, []);
                }
                this.activeNotes.get(noteKey).push(prevNoteName);

                if (this.onNotePlay) {
                    this.onNotePlay(
                        noteName,
                        prevNoteName,
                        this.channelInstruments[data.channel],
                        data.channel === 9,
                    );
                }
            });

            this.synth.eventHandler.addEvent(
                'noteOff',
                'viz-release',
                (data) => {
                    const noteName = midiNoteToName(data.midiNote);
                    const noteKey = `${data.channel}-${data.midiNote}`;
                    const stack = this.activeNotes.get(noteKey);
                    const prevNoteName = stack ? stack.shift() : undefined;
                    if (stack && stack.length === 0) {
                        this.activeNotes.delete(noteKey);
                    }

                    if (this.onNoteRelease) {
                        this.onNoteRelease(noteName, prevNoteName);
                    }
                },
            );

            this.synth.eventHandler.addEvent(
                'programChange',
                'viz-pc',
                (data) => {
                    this.channelInstruments[data.channel] = data.program;
                },
            );

            this.sequencer.eventHandler.addEvent(
                'songEnded',
                'viz-stop',
                () => {
                    this.stop();
                },
            );
        }
    }

    _updateMediaSessionPosition() {
        if (
            'mediaSession' in navigator &&
            this.duration > 0 &&
            this.sequencer
        ) {
            navigator.mediaSession.setPositionState({
                duration: this.duration,
                playbackRate: this.sequencer.playbackRate,
                position: this.sequencer.currentTime,
            });
        }
    }

    async play(midiBuffer) {
        this.stop(); // Stop any existing playback

        // Ensure audio context is started and synth exists
        await this.initialize();

        // Ensure volume is up for playback
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(
                1,
                Tone.context.currentTime,
                0.01,
            );
        }

        // Reset tracking
        this.channelInstruments = new Array(16).fill(0);
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();

        // Load MIDI data into sequencer
        this.sequencer.loadNewSongList([{ binary: midiBuffer }]);
        this.duration = this.sequencer.duration;

        // Loop settings
        this.sequencer.loopCount = -1; // Infinite loop as per original behavior
        this.sequencer.play();

        this.dummyAudio.currentTime = 0;
        this.dummyAudio
            .play()
            .catch((e) => console.warn('Dummy audio play failed:', e));

        if ('mediaSession' in navigator)
            navigator.mediaSession.playbackState = 'playing';

        this.isPlaying = true;
        this._updateMediaSessionPosition();
    }

    _hardResetSynth() {
        if (this.synth) {
            this.synth.stopAll();

            for (let i = 0; i < 16; i++) {
                this.synth.controllerChange(i, 120, 0); // All Sound Off
                this.synth.controllerChange(i, 123, 0); // All Notes Off
                this.synth.controllerChange(i, 64, 0); // Sustain Pedal Off
                this.synth.controllerChange(i, 121, 0); // Reset All Controllers
                this.synth.pitchWheel(i, 8192); // Reset Pitch Bend
            }
        }
    }

    stop() {
        if (this.sequencer) {
            this.sequencer.pause();
            this.sequencer.currentTime = 0;
        }

        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(
                0,
                Tone.context.currentTime,
                0.01,
            );
        }

        this._hardResetSynth();
        if (this._resetTimeout) clearTimeout(this._resetTimeout);
        this._resetTimeout = setTimeout(() => {
            this._hardResetSynth();
        }, 150);

        this.dummyAudio.pause();
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
        }

        if (this.onStop) {
            this.onStop();
        }
        this.isPlaying = false;
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();
    }

    pause() {
        if (this.isPlaying && this.sequencer) {
            this.sequencer.pause();

            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(
                    0,
                    Tone.context.currentTime,
                    0.01,
                );
            }

            this._hardResetSynth();
            if (this._resetTimeout) clearTimeout(this._resetTimeout);
            this._resetTimeout = setTimeout(() => {
                this._hardResetSynth();
            }, 150);

            this.dummyAudio.pause();
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }

            this._updateMediaSessionPosition();
            this.isPlaying = false;
        }
    }

    resume() {
        if (!this.isPlaying && this.sequencer) {
            if (this._resetTimeout) clearTimeout(this._resetTimeout);

            this._hardResetSynth();

            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(
                    1,
                    Tone.context.currentTime,
                    0.01,
                );
            }
            this.sequencer.play();

            this.dummyAudio
                .play()
                .catch((e) => console.warn('Dummy audio play failed:', e));
            if ('mediaSession' in navigator)
                navigator.mediaSession.playbackState = 'playing';

            this.isPlaying = true;
            this._updateMediaSessionPosition();
        }
    }
}
