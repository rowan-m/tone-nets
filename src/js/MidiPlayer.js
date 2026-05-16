import * as Tone from 'tone';
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { Utils } from './Utils.js';

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
        this.isLooping = true;

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

            // Limit voice count on mobile/low-end to prevent stuttering/corruption
            // Complex MIDI files can easily exceed 200+ voices which is heavy for SF2 synthesis
            // We use autoAllocateVoices so it can scale up dynamically if needed without hard cutoffs,
            // while starting from a reasonable base.
            const voiceCap = Utils.isMobile() ? 64 : 128;
            this.synth.setMasterParameter('voiceCap', voiceCap);
            this.synth.setMasterParameter('autoAllocateVoices', true);

            // Connect synthesizer to master gain
            this.synth.connect(this.masterGain);

            this._setupBackgroundAudio(rawCtx);

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
            this._setupSynthEvents();
        }
    }

    _setupBackgroundAudio(rawCtx) {
        // Fix for mobile background audio:
        // Use MediaStreamDestination and an <audio> element to keep the context alive at high priority.
        // This is more robust than a dummy MP3 loop on iOS/Android.
        if (rawCtx.createMediaStreamDestination) {
            const dest = rawCtx.createMediaStreamDestination();
            this.masterGain.connect(dest);

            const streamAudio = new Audio();
            streamAudio.srcObject = dest.stream;
            streamAudio.muted = true; // MUST be muted to prevent phasing/echo from the latent stream path
            if (streamAudio.setAttribute) {
                streamAudio.setAttribute('playsinline', ''); // Required for iOS
            }

            // Append to DOM to ensure browser respects it as active media when backgrounded
            if (typeof document !== 'undefined' && document.body) {
                streamAudio.style.display = 'none';
                document.body.appendChild(streamAudio);
            }

            streamAudio
                .play()
                .catch((e) => console.warn('Stream audio play failed', e));
            this.streamAudio = streamAudio;
        }
    }

    _setupSynthEvents() {
        this.synth.eventHandler.addEvent('noteOn', 'viz-play', (data) => {
            const noteName = Utils.midiNoteToName(data.midiNote);
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

        this.synth.eventHandler.addEvent('noteOff', 'viz-release', (data) => {
            const noteName = Utils.midiNoteToName(data.midiNote);
            const noteKey = `${data.channel}-${data.midiNote}`;
            const stack = this.activeNotes.get(noteKey);
            const prevNoteName = stack ? stack.shift() : undefined;
            if (stack && stack.length === 0) {
                this.activeNotes.delete(noteKey);
            }

            if (this.onNoteRelease) {
                this.onNoteRelease(noteName, prevNoteName);
            }
        });

        this.synth.eventHandler.addEvent('programChange', 'viz-pc', (data) => {
            this.channelInstruments[data.channel] = data.program;
        });

        this.sequencer.eventHandler.addEvent(
            'songEnded',
            'viz-loop-reset',
            () => {
                // Reset tracking and visualization for the loop
                this.lastNotePerChannel.clear();
                this.activeNotes.clear();
                if (this.onStop) {
                    this.onStop();
                }

                // Explicitly restart the sequencer if we are still marked as playing and looping is enabled
                if (this.isPlaying && this.isLooping) {
                    this.sequencer.currentTime = 0;
                    this._hardResetSynth();
                    this.sequencer.play();
                } else {
                    this.isPlaying = false;
                    this.dummyAudio.pause();
                    if (this.streamAudio) this.streamAudio.pause();
                    if ('mediaSession' in navigator) {
                        navigator.mediaSession.playbackState = 'none';
                    }
                }
                this.updateMediaSessionPosition();
            },
        );
    }

    updateMediaSessionPosition() {
        if ('mediaSession' in navigator && this.sequencer) {
            // Update duration from sequencer if it's currently 0 or changed
            if (this.sequencer.duration > 0) {
                if (
                    this.duration <= 0 ||
                    Math.abs(this.duration - this.sequencer.duration) > 0.1
                ) {
                    this.duration = this.sequencer.duration;
                }
            }

            if (this.duration > 0) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: this.duration,
                        playbackRate: this.sequencer.playbackRate,
                        position: Math.min(
                            this.sequencer.currentTime,
                            this.duration,
                        ),
                    });
                } catch (e) {
                    console.warn(
                        'Failed to set MediaSession position state:',
                        e,
                    );
                }
            }
        }
    }

    async play(midiBuffer, autoplay = true) {
        this.stop(); // Stop any existing playback

        // Ensure audio context is started and synth exists
        await this.initialize();

        // Reset tracking
        this.channelInstruments = new Array(16).fill(0);
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();

        // Load MIDI data into sequencer
        this.sequencer.loadNewSongList([
            { binary: new Uint8Array(midiBuffer) },
        ]);

        // Only update duration if sequencer has a valid one
        if (this.sequencer.duration > 0) {
            this.duration = this.sequencer.duration;
        }

        // Loop settings
        this.sequencer.loop = true;
        this.sequencer.loopCount = -1; // Try both properties to be safe

        if (autoplay) {
            // Ensure volume is up for playback
            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(
                    1,
                    Tone.context.currentTime,
                    0.01,
                );
            }

            this.sequencer.play();

            this.dummyAudio.currentTime = 0;
            this.dummyAudio
                .play()
                .catch((e) => console.warn('Dummy audio play failed:', e));

            if ('mediaSession' in navigator)
                navigator.mediaSession.playbackState = 'playing';

            this.isPlaying = true;

            // Start periodic update for MediaSession
            this._startMediaSessionInterval();
        } else {
            // If not autoplaying, ensure we're in a "paused" state
            if (this.sequencer) {
                this.sequencer.pause();
            }

            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(
                    0,
                    Tone.context.currentTime,
                    0.01,
                );
            }
            if ('mediaSession' in navigator)
                navigator.mediaSession.playbackState = 'paused';
            this.isPlaying = false;
        }

        this.updateMediaSessionPosition();
    }

    _startMediaSessionInterval() {
        this._stopMediaSessionInterval();
        this._mediaSessionInterval = setInterval(() => {
            if (this.isPlaying) {
                this.updateMediaSessionPosition();
            } else {
                this._stopMediaSessionInterval();
            }
        }, 1000);
    }

    _stopMediaSessionInterval() {
        if (this._mediaSessionInterval) {
            clearInterval(this._mediaSessionInterval);
            this._mediaSessionInterval = null;
        }
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
        if (this.streamAudio) this.streamAudio.pause();
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
        }

        if (this.onStop) {
            this.onStop();
        }
        this.isPlaying = false;
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();
        this._stopMediaSessionInterval();
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
            if (this.streamAudio) this.streamAudio.pause();
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }

            this.updateMediaSessionPosition();
            this.isPlaying = false;
            this._stopMediaSessionInterval();
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
            if (this.streamAudio) {
                this.streamAudio
                    .play()
                    .catch((e) => console.warn('Stream audio play failed:', e));
            }
            if ('mediaSession' in navigator)
                navigator.mediaSession.playbackState = 'playing';

            this.isPlaying = true;
            this.updateMediaSessionPosition();
            this._startMediaSessionInterval();
        }
    }

    restart() {
        if (this.sequencer) {
            this.sequencer.currentTime = 0;
            this._hardResetSynth();
            this.updateMediaSessionPosition();

            if (this.onStop) {
                this.onStop();
            }
        }
    }
}
