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
        this.audioContext = null;
        this.channelInstruments = Array.from({ length: 16 }, () => 0);
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
        this._initPromise = null;
        this.analyser = null;
        this._frequencyData = null;
    }

    async loadSoundfont(url = '/creative-emu10k1-8mbgmsfx.sf2') {
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Failed to load soundfont: ${response.statusText}`);
        this.sf2Buffer = await response.arrayBuffer();
    }

    initialize() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = (async () => {
            try {
                // If we haven't fetched the buffer yet, do it now
                if (!this.sf2Buffer) {
                    await this.loadSoundfont();
                }

                // Only create and resume the native AudioContext once the user has interacted
                if (!this.audioContext) {
                    const AudioContextClass =
                        globalThis.AudioContext ||
                        globalThis.webkitAudioContext;
                    this.audioContext = new AudioContextClass();
                }

                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }

                if (!this.synth) {
                    const rawCtx = this.audioContext;

                    // Register the AudioWorklet processor
                    await rawCtx.audioWorklet.addModule(processorUrl);

                    // Create master gain for muting/pausing
                    this.masterGain = rawCtx.createGain();
                    this.masterGain.gain.setValueAtTime(0, rawCtx.currentTime);

                    // Create Analyser for visualization
                    this.analyser = rawCtx.createAnalyser();
                    this.analyser.fftSize = 2048; // 1024 bins, much better resolution for log mapping
                    this._frequencyData = new Uint8Array(
                        this.analyser.frequencyBinCount,
                    );
                    this.masterGain.connect(this.analyser);

                    // Wait for the clock to actually start moving and stabilize.
                    // This is crucial in Chromium-based browsers under high load or throttling,
                    // as the clock can remain at 0 or jitter significantly during initial resumption.
                    const startCtxTime = rawCtx.currentTime;
                    const startTime = performance.now();
                    while (
                        rawCtx.currentTime === startCtxTime &&
                        performance.now() - startTime < 2000
                    ) {
                        await this._delay(50);
                    }

                    // Additional stabilization delay to allow hardware sample rate to settle
                    await this._delay(500);

                    // Initialize SpessaSynth
                    this.synth = new WorkletSynthesizer(rawCtx);

                    // Limit voice count on mobile/low-end to prevent stuttering/corruption
                    const isMobile = Utils.isMobile();
                    const voiceCap = isMobile ? 64 : 128;
                    this.synth.setSystemParameter('voiceCap', voiceCap);
                    this.synth.setSystemParameter('autoAllocateVoices', false);

                    if (isMobile) {
                        this.synth.setSystemParameter('interpolationType', 0);
                    }

                    // Connect synthesizer to master gain
                    this.synth.connect(this.masterGain);

                    this._setupBackgroundAudio(rawCtx, isMobile);

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

                    // Final stabilization delay after heavy resource loading (SF2 parsing/upload)
                    await this._delay(300);

                    // Warm up synthesizer JIT compilation silently
                    const ctx = this.masterGain.context;
                    this.masterGain.gain.cancelScheduledValues(ctx.currentTime);
                    this.masterGain.gain.setValueAtTime(0, ctx.currentTime);

                    const warmUpChannels = [0, 1, 2, 9];
                    for (const ch of warmUpChannels) {
                        this.synth.noteOn(ch, 60, 1);
                        this.synth.noteOff(ch, 60);
                    }
                    await this._delay(100);

                    // Ensure gain is still 0 at the end of initialization
                    this.masterGain.gain.setValueAtTime(0, ctx.currentTime);
                }
            } catch (error) {
                this._initPromise = null;
                throw error;
            }
        })();

        return this._initPromise;
    }

    _setupBackgroundAudio(rawCtx, isMobile) {
        // Fix for mobile background audio:
        // Use MediaStreamDestination and an <audio> element to keep the context alive at high priority.
        // This is more robust than a dummy MP3 loop on iOS/Android.
        if (isMobile && rawCtx.createMediaStreamDestination) {
            const dest = rawCtx.createMediaStreamDestination();
            this.masterGain.connect(dest);

            const streamAudio = new Audio();
            streamAudio.srcObject = dest.stream;
            // IMPORTANT: Do NOT mute. If muted, mobile OS suspends it in background.
            // Since we didn't connect masterGain to rawCtx.destination, there is no echo.
            streamAudio.muted = false;
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
        } else {
            // Default desktop routing
            this.masterGain.connect(rawCtx.destination);
        }
    }

    _setupSynthEvents() {
        this.synth.eventHandler.addEvent('noteOn', 'viz-play', (data) => {
            const noteName = Utils.midiNoteToName(data.midiNote);
            const prevNoteName = this.lastNotePerChannel.get(data.channel);
            this.lastNotePerChannel.set(data.channel, noteName);

            // Store prevNoteName for this specific note instance using integer keys to avoid garbage string allocation
            const noteKey = (data.channel << 8) | data.midiNote;
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
            const noteKey = (data.channel << 8) | data.midiNote;
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
                if (this.onStop) {
                    this.onStop();
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

    _setMasterGainTarget(targetValue) {
        if (this.masterGain) {
            const ctx = this.masterGain.context;
            this.masterGain.gain.cancelScheduledValues(ctx.currentTime);
            this.masterGain.gain.setValueAtTime(
                this.masterGain.gain.value,
                ctx.currentTime,
            );
            this.masterGain.gain.setTargetAtTime(
                targetValue,
                ctx.currentTime,
                0.01,
            );
        }
    }

    _setMediaSessionState(state) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = state;
        }
    }

    _playDummyAudio() {
        this.dummyAudio
            .play()
            .catch((e) => console.warn('Dummy audio play failed:', e));

        if (this.streamAudio) {
            this.streamAudio
                .play()
                .catch((e) => console.warn('Stream audio play failed:', e));
        }
    }

    _pauseDummyAudio() {
        this.dummyAudio.pause();
        if (this.streamAudio) this.streamAudio.pause();
    }

    async play(midiBuffer, autoplay = true) {
        const playToken = Symbol('play');
        this._currentPlayToken = playToken;

        this.stop(); // Stop any existing playback

        if (this._resetTimeout) {
            clearTimeout(this._resetTimeout);
            this._resetTimeout = null;
        }

        // Ensure audio context is started and synth exists
        await this.initialize();

        if (this._currentPlayToken !== playToken) return;

        this._hardResetSynth();

        // Reset tracking
        this.channelInstruments = Array.from({ length: 16 }, () => 0);
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();

        // Setup loading promise to wait for songChange event
        const loadPromise = new Promise((resolve) => {
            this.sequencer.eventHandler.addEvent(
                'songChange',
                'midi-player-load',
                (data) => {
                    this.sequencer.eventHandler.removeEvent(
                        'songChange',
                        'midi-player-load',
                    );
                    resolve(data);
                },
            );
        });

        // Load MIDI data into sequencer
        this.sequencer.loadNewSongList([
            { binary: new Uint8Array(midiBuffer) },
        ]);

        await loadPromise;

        if (this._currentPlayToken !== playToken) return;

        // Force time to 0 and playback rate to 1 to prevent "catch-up" speed artifacts
        // that can occur if the clock drifted during the loadPromise wait.
        if (this.sequencer) {
            this.sequencer.currentTime = 0;
            this.sequencer.playbackRate = 1;
        }

        // Small propagation delay to ensure sequencer state resets are processed
        // before playback starts, especially under high CPU load.
        await this._delay(50);

        if (this._currentPlayToken !== playToken) return;

        this._finalizePlayback(autoplay);
    }

    _finalizePlayback(autoplay) {
        // Only update duration if sequencer has a valid one
        if (this.sequencer.duration > 0) {
            this.duration = this.sequencer.duration;
        }

        // Loop settings
        this.sequencer.loop = true;
        this.sequencer.loopCount = -1; // Try both properties to be safe

        if (autoplay) {
            this._setMasterGainTarget(1);
            this.sequencer.play();
            this._playDummyAudio();
            this._setMediaSessionState('playing');

            this.isPlaying = true;
            this._startMediaSessionInterval();
        } else {
            if (this.sequencer) {
                this.sequencer.pause();
            }
            this._setMasterGainTarget(0);
            this._setMediaSessionState('paused');
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
            this.sequencer.eventHandler.removeEvent(
                'songChange',
                'midi-player-load',
            );
            this.sequencer.pause();
            this.sequencer.currentTime = 0;
        }

        this._setMasterGainTarget(0);

        this._hardResetSynth();
        if (this._resetTimeout) clearTimeout(this._resetTimeout);
        this._resetTimeout = setTimeout(() => {
            this._hardResetSynth();
        }, 150);

        this._pauseDummyAudio();
        this._setMediaSessionState('none');

        this.isPlaying = false;
        this.lastNotePerChannel.clear();
        this.activeNotes.clear();
        if (this.onStop) {
            this.onStop();
        }
        this._stopMediaSessionInterval();
    }

    pause() {
        if (this.isPlaying && this.sequencer) {
            this.sequencer.pause();
            this._setMasterGainTarget(0);

            this._hardResetSynth();
            if (this._resetTimeout) clearTimeout(this._resetTimeout);
            this._resetTimeout = setTimeout(() => {
                this._hardResetSynth();
            }, 150);

            this._pauseDummyAudio();
            this._setMediaSessionState('paused');

            this.updateMediaSessionPosition();
            this.isPlaying = false;
            this._stopMediaSessionInterval();
        }
    }

    resume() {
        if (!this.isPlaying && this.sequencer) {
            if (this._resetTimeout) clearTimeout(this._resetTimeout);

            this._hardResetSynth();
            this._setMasterGainTarget(1);

            this.sequencer.play();
            this._playDummyAudio();
            this._setMediaSessionState('playing');

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

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getFrequencyData() {
        if (!this.analyser) return null;
        if (
            !this._frequencyData ||
            this._frequencyData.length !== this.analyser.frequencyBinCount
        ) {
            this._frequencyData = new Uint8Array(
                this.analyser.frequencyBinCount,
            );
        }
        this.analyser.getByteFrequencyData(this._frequencyData);
        return this._frequencyData;
    }
}
