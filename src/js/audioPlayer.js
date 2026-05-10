import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export class MidiPlayer {
    constructor() {
        this.synth = null;
        this.sf2Buffer = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.scheduledEvents = [];
        this.masterGain = null;
        this.channelInstruments = new Array(16).fill(0);

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
            // Tone.context.rawContext returns a standardized-audio-context wrapper, we need the actual browser context
            const rawCtx =
                Tone.context.rawContext._nativeContext ||
                Tone.context.rawContext;
            if (rawCtx.state === 'suspended') {
                await rawCtx.resume();
            }

            // Register the AudioWorklet processor BEFORE creating the synthesizer
            await rawCtx.audioWorklet.addModule(processorUrl);

            // Create master gain
            this.masterGain = rawCtx.createGain();
            this.masterGain.gain.value = this.isMuted ? 0 : 1;
            this.masterGain.connect(rawCtx.destination);

            // Initialize SpessaSynth
            this.synth = new WorkletSynthesizer(rawCtx);

            // Disconnect from default destination (if any) and connect to our master gain
            this.synth.disconnect();
            this.synth.connect(this.masterGain);

            // Wait for worklet to be ready
            await this.synth.isReady;

            // Load the SoundFont
            await this.synth.soundBankManager.addSoundBank(
                this.sf2Buffer,
                'default',
            );
        }
    }

    _scheduleNotePlay(channel, note, prevNote, startDelay) {
        return Tone.Transport.schedule((time) => {
            if (this.synth) {
                this.synth.noteOn(
                    channel,
                    note.midi,
                    Math.round(note.velocity * 127),
                    { time },
                );

                Tone.Draw.schedule(() => {
                    if (this.onNotePlay) {
                        this.onNotePlay(
                            note.name,
                            prevNote ? prevNote.name : null,
                            // eslint-disable-next-line security/detect-object-injection
                            this.channelInstruments[channel],
                            channel === 9,
                        );
                    }
                }, time);
            }
        }, note.time + startDelay);
    }

    _scheduleNoteRelease(channel, note, prevNote, startDelay) {
        return Tone.Transport.schedule(
            (time) => {
                if (this.synth) {
                    this.synth.noteOff(channel, note.midi, { time });

                    Tone.Draw.schedule(() => {
                        if (this.onNoteRelease) {
                            this.onNoteRelease(
                                note.name,
                                prevNote ? prevNote.name : null,
                                // eslint-disable-next-line security/detect-object-injection
                                this.channelInstruments[channel],
                                channel === 9,
                            );
                        }
                    }, time);
                }
            },
            note.time + startDelay + note.duration,
        );
    }

    _scheduleControlChange(channel, ccNumber, cc, startDelay) {
        let scheduleTime = cc.time + startDelay;
        if ((ccNumber === '0' || ccNumber === '32') && cc.time === 0) {
            scheduleTime = 0;
        }
        return Tone.Transport.schedule((time) => {
            if (this.synth) {
                this.synth.controllerChange(
                    channel,
                    parseInt(ccNumber, 10),
                    Math.round(cc.value * 127),
                    { time },
                );
            }
        }, scheduleTime);
    }

    async play(midiBuffer) {
        this.stop(); // Stop any existing playback

        // Ensure audio context is started and synth exists
        await this.initialize();

        const midi = new Midi(midiBuffer);
        const startDelay = 0.5; // Start half a second from the beginning of Transport

        // Reset instrument tracking
        this.channelInstruments = new Array(16).fill(0);

        midi.tracks.forEach((track) => {
            const channel = track.channel; // 0-15

            // Track the instrument for this channel
            if (
                track.instrument &&
                typeof track.instrument.number === 'number'
            ) {
                // eslint-disable-next-line security/detect-object-injection
                this.channelInstruments[channel] = track.instrument.number;
            }

            // Control Changes (Volume, Pan, Sustain, etc.) - Schedule these FIRST so Bank Selects happen before Program Changes
            Object.entries(track.controlChanges).forEach(
                ([ccNumber, ccList]) => {
                    ccList.forEach((cc) => {
                        const scheduledEvent = this._scheduleControlChange(
                            channel,
                            ccNumber,
                            cc,
                            startDelay,
                        );
                        this.scheduledEvents.push(scheduledEvent);
                    });
                },
            );

            // Program Change (Instrument) - Schedule at 0 so it happens before startDelay (and after Bank Selects)
            if (
                track.instrument &&
                typeof track.instrument.number === 'number'
            ) {
                const scheduledEvent = Tone.Transport.schedule((time) => {
                    if (this.synth) {
                        this.synth.programChange(
                            channel,
                            track.instrument.number,
                            { time },
                        );
                    }
                }, 0.01); // 0.01 to ensure it definitely happens after CC0 at 0.0
                this.scheduledEvents.push(scheduledEvent);
            }

            // Pitch Bends
            track.pitchBends.forEach((pb) => {
                const scheduledEvent = Tone.Transport.schedule((time) => {
                    if (this.synth) {
                        this.synth.pitchWheel(
                            channel,
                            Math.round((pb.value + 1) * 8192),
                            { time },
                        );
                    }
                }, pb.time + startDelay);
                this.scheduledEvents.push(scheduledEvent);
            });

            // Notes
            track.notes.forEach((note, index) => {
                const prevNote = index > 0 ? track.notes[index - 1] : null;

                const scheduledEvent = this._scheduleNotePlay(
                    channel,
                    note,
                    prevNote,
                    startDelay,
                );
                this.scheduledEvents.push(scheduledEvent);

                const releaseEvent = this._scheduleNoteRelease(
                    channel,
                    note,
                    prevNote,
                    startDelay,
                );
                this.scheduledEvents.push(releaseEvent);
            });
        });

        // Ensure transport starts from the beginning
        Tone.Transport.loop = true;
        Tone.Transport.loopStart = 0;
        // midi.duration provides the time of the last event. We add the initial delay and a 2-second tail for release tails.
        Tone.Transport.loopEnd = midi.duration + startDelay + 2;

        Tone.Transport.position = 0;
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        Tone.Transport.stop();
        Tone.Transport.loop = false;

        // Clear all scheduled events on the Tone timeline
        this.scheduledEvents.forEach((eventId) =>
            Tone.Transport.clear(eventId),
        );
        this.scheduledEvents = [];
        Tone.Transport.cancel(0);
        Tone.Draw.cancel(0);

        if (this.synth) {
            // Briefly disconnect the synth to hard-cut any lingering reverb/audio buffers
            if (this.masterGain) {
                this.masterGain.gain.setTargetAtTime(
                    0,
                    Tone.context.currentTime,
                    0.01,
                );
            }

            // SpessaSynth specific stop mechanism (stops all active voices instantly)
            if (typeof this.synth.stopAll === 'function') {
                this.synth.stopAll();
            }

            // Send standard MIDI "Panic" messages across all 16 channels to reset state
            for (let i = 0; i < 16; i++) {
                this.synth.controllerChange(i, 120, 0); // All Sound Off (Aggressive)
                this.synth.controllerChange(i, 123, 0); // All Notes Off
                this.synth.controllerChange(i, 64, 0); // Sustain Pedal Off
                this.synth.controllerChange(i, 121, 0); // Reset All Controllers
                this.synth.pitchWheel(i, 8192); // Reset Pitch Bend to center
            }

            // Restore volume after a tiny delay, ensuring the next track plays normally
            if (this.masterGain) {
                setTimeout(() => {
                    if (!this.isMuted) {
                        this.masterGain.gain.setTargetAtTime(
                            1,
                            Tone.context.currentTime,
                            0.01,
                        );
                    }
                }, 50);
            }
        }

        if (this.onStop) {
            this.onStop();
        }
        this.isPlaying = false;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 1;
        }
        if (this.isMuted && this.synth) {
            // Silence currently playing notes
            for (let i = 0; i < 16; i++) {
                this.synth.controllerChange(i, 123, 0);
            }
        }
        return this.isMuted;
    }
}
