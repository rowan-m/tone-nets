import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Utils } from './Utils.js';

describe('Utils', () => {
    describe('isMobile', () => {
        let originalNavigator;
        let originalWindow;

        beforeEach(() => {
            // Arrange: Keep a reference to the global objects to restore them later
            originalNavigator = global.navigator;
            originalWindow = global.window;
        });

        afterEach(() => {
            // Teardown: Restore the global objects to avoid state leakage
            Object.defineProperty(global, 'navigator', {
                value: originalNavigator,
                configurable: true,
                writable: true,
            });
            Object.defineProperty(global, 'window', {
                value: originalWindow,
                configurable: true,
                writable: true,
            });
        });

        it('should return true for mobile user agents (e.g., iPhone)', () => {
            // Arrange
            Object.defineProperty(global, 'navigator', {
                value: {
                    userAgent:
                        'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X)',
                },
                configurable: true,
                writable: true,
            });
            Object.defineProperty(global, 'window', {
                value: { innerWidth: 1024 },
                configurable: true,
                writable: true,
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should return true for narrow window widths (responsive threshold)', () => {
            // Arrange
            Object.defineProperty(global, 'navigator', {
                value: {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                configurable: true,
                writable: true,
            });
            Object.defineProperty(global, 'window', {
                value: { innerWidth: 768 },
                configurable: true,
                writable: true,
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should return false for desktop user agents and wide windows', () => {
            // Arrange
            Object.defineProperty(global, 'navigator', {
                value: {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                configurable: true,
                writable: true,
            });
            Object.defineProperty(global, 'window', {
                value: { innerWidth: 1024 },
                configurable: true,
                writable: true,
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(false);
        });

        it('should handle undefined navigator or window safely (SSR/Node edge case)', () => {
            // Arrange
            Object.defineProperty(global, 'navigator', {
                value: undefined,
                configurable: true,
                writable: true,
            });
            Object.defineProperty(global, 'window', {
                value: undefined,
                configurable: true,
                writable: true,
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(false);
        });
    });

    describe('noteToSemitone', () => {
        it('should correctly convert natural notes to semitones', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C4')).toBe(48);
            expect(Utils.noteToSemitone('D4')).toBe(50);
            expect(Utils.noteToSemitone('E4')).toBe(52);
            expect(Utils.noteToSemitone('F4')).toBe(53);
            expect(Utils.noteToSemitone('G4')).toBe(55);
            expect(Utils.noteToSemitone('A4')).toBe(57);
            expect(Utils.noteToSemitone('B4')).toBe(59);
            expect(Utils.noteToSemitone('C5')).toBe(60);
        });

        it('should correctly convert sharp and flat notes', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C#4')).toBe(49);
            expect(Utils.noteToSemitone('Db4')).toBe(49);
            expect(Utils.noteToSemitone('D#4')).toBe(51);
            expect(Utils.noteToSemitone('Eb4')).toBe(51);
            expect(Utils.noteToSemitone('F#4')).toBe(54);
            expect(Utils.noteToSemitone('Gb4')).toBe(54);
            expect(Utils.noteToSemitone('G#4')).toBe(56);
            expect(Utils.noteToSemitone('Ab4')).toBe(56);
            expect(Utils.noteToSemitone('A#4')).toBe(58);
            expect(Utils.noteToSemitone('Bb4')).toBe(58);
        });

        it('should correctly convert enharmonic equivalents (edge cases: E#, B#, Cb, Fb)', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('E#4')).toBe(53); // Same as F4
            expect(Utils.noteToSemitone('B#4')).toBe(48); // Same as C4
            // Note: In Utils.js, octave parsing is strictly string concat/math.
            // Cb4 parses as Cb (11) + (4 * 12) = 59 (B4).
            expect(Utils.noteToSemitone('Cb4')).toBe(59);
            expect(Utils.noteToSemitone('Fb4')).toBe(52); // Same as E4
        });

        it('should default to octave 4 if no octave is provided (boundary condition)', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C')).toBe(48);
            expect(Utils.noteToSemitone('G#')).toBe(56);
        });

        it('should handle extreme octaves including negative and multi-digit', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C0')).toBe(0);
            expect(Utils.noteToSemitone('C-1')).toBe(-12);
            expect(Utils.noteToSemitone('C10')).toBe(120);
        });

        it('should handle case insensitivity', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('c4')).toBe(48);
            expect(Utils.noteToSemitone('Eb4')).toBe(51);
            expect(Utils.noteToSemitone('eb4')).toBe(51);
        });

        it('should return 0 for invalid notes and edge case strings (negative scenario)', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('H4')).toBe(0);
            expect(Utils.noteToSemitone('Invalid')).toBe(0);
            expect(Utils.noteToSemitone('')).toBe(0);
            // Decimal octaves fail the regex ^([A-G][#B]?)(-?\d{1,2})?$
            expect(Utils.noteToSemitone('C#4.5')).toBe(0);
        });

        it('should utilize the cache for subsequent identical calls', () => {
            // Arrange: We don't have direct access to NOTE_CACHE, but we can verify it doesn't fail
            // Act: First call (cache miss)
            const firstResult = Utils.noteToSemitone('A4');
            // Act: Second call (cache hit)
            const secondResult = Utils.noteToSemitone('A4');

            // Assert
            expect(firstResult).toBe(57);
            expect(secondResult).toBe(57);
        });
    });

    describe('midiNoteToName', () => {
        it('should correctly convert midi notes to string names', () => {
            // Arrange & Act & Assert
            expect(Utils.midiNoteToName(60)).toBe('C4');
            expect(Utils.midiNoteToName(61)).toBe('C#4');
            expect(Utils.midiNoteToName(69)).toBe('A4');
            expect(Utils.midiNoteToName(12)).toBe('C0');
            expect(Utils.midiNoteToName(0)).toBe('C-1');
        });
    });

    describe('getInterval', () => {
        it('should calculate the directed pitch class interval (modulo 12)', () => {
            // Arrange & Act & Assert
            // Upward intervals
            expect(Utils.getInterval('C4', 'C4')).toBe(0);
            expect(Utils.getInterval('C4', 'D4')).toBe(2);
            expect(Utils.getInterval('C4', 'G4')).toBe(7);
            expect(Utils.getInterval('B4', 'C5')).toBe(1);

            // Downward intervals (should still yield positive modulo 12 results)
            expect(Utils.getInterval('G4', 'C4')).toBe(5); // 48 - 55 = -7. (-7 % 12 + 12) % 12 = 5
            expect(Utils.getInterval('C5', 'C4')).toBe(0);
            expect(Utils.getInterval('E4', 'C4')).toBe(8); // 48 - 52 = -4. (-4 % 12 + 12) % 12 = 8
        });

        it('should handle invalid notes gracefully (negative scenario)', () => {
            // Arrange & Act
            const invalidToInvalid = Utils.getInterval('Invalid', 'H4');
            const validToInvalid = Utils.getInterval('C4', 'Invalid');

            // Assert
            // If invalid, noteToSemitone returns 0. Interval from 0 to 0 is 0.
            expect(invalidToInvalid).toBe(0);
            // Interval from C4 (48) to Invalid (0) -> 0 - 48 = -48 -> 0
            expect(validToInvalid).toBe(0);
        });
    });

    describe('getIntervalName', () => {
        it('should return the correct interval name for all 12 pitch classes', () => {
            // Arrange & Act & Assert
            expect(Utils.getIntervalName('C4', 'C4')).toBe('Perfect Unison');
            expect(Utils.getIntervalName('C4', 'C#4')).toBe('Minor Second');
            expect(Utils.getIntervalName('C4', 'D4')).toBe('Major Second');
            expect(Utils.getIntervalName('C4', 'Eb4')).toBe('Minor Third');
            expect(Utils.getIntervalName('C4', 'E4')).toBe('Major Third');
            expect(Utils.getIntervalName('C4', 'F4')).toBe('Perfect Fourth');
            expect(Utils.getIntervalName('C4', 'F#4')).toBe('Tritone');
            expect(Utils.getIntervalName('C4', 'G4')).toBe('Perfect Fifth');
            expect(Utils.getIntervalName('C4', 'Ab4')).toBe('Minor Sixth');
            expect(Utils.getIntervalName('C4', 'A4')).toBe('Major Sixth');
            expect(Utils.getIntervalName('C4', 'Bb4')).toBe('Minor Seventh');
            expect(Utils.getIntervalName('C4', 'B4')).toBe('Major Seventh');
        });

        it('should handle extreme octave differences correctly (boundary condition)', () => {
            // Arrange & Act & Assert
            expect(Utils.getIntervalName('C4', 'C5')).toBe('Perfect Unison');
            expect(Utils.getIntervalName('C4', 'G5')).toBe('Perfect Fifth');
            expect(Utils.getIntervalName('C2', 'E7')).toBe('Major Third');
        });

        it('should handle downward intervals correctly', () => {
            // Arrange & Act & Assert
            // G4 to C4 is a perfect 4th down (pitch class interval is 5 semitones up)
            expect(Utils.getIntervalName('G4', 'C4')).toBe('Perfect Fourth');
            expect(Utils.getIntervalName('E4', 'C4')).toBe('Minor Sixth');
        });

        it('should return Perfect Unison if invalid notes are provided (negative scenario)', () => {
            // Arrange & Act & Assert
            // Invalid notes resolve to 0 difference.
            expect(Utils.getIntervalName('Invalid', 'AlsoInvalid')).toBe(
                'Perfect Unison',
            );
        });
    });

    describe('getInstrumentEmoji', () => {
        it('should return a drum emoji if isDrums is true', () => {
            // Arrange & Act & Assert
            expect(Utils.getInstrumentEmoji(0, true)).toBe('🥁');
            expect(Utils.getInstrumentEmoji(42, true)).toBe('🥁');
        });

        it('should return the correct emoji for known program families', () => {
            // Arrange & Act & Assert
            expect(Utils.getInstrumentEmoji(0)).toBe('🎹'); // Piano (0)
            expect(Utils.getInstrumentEmoji(4)).toBe('🎹'); // Also Piano family (0-7)
            expect(Utils.getInstrumentEmoji(24)).toBe('🎸'); // Guitar
            expect(Utils.getInstrumentEmoji(30)).toBe('🎸'); // Also Guitar family (24-31)
            expect(Utils.getInstrumentEmoji(40)).toBe('🎻'); // Strings
            expect(Utils.getInstrumentEmoji(47)).toBe('🎻'); // Strings
            expect(Utils.getInstrumentEmoji(80)).toBe('⚡'); // Synth Lead
            expect(Utils.getInstrumentEmoji(88)).toBe('💠'); // Synth Pad
            expect(Utils.getInstrumentEmoji(112)).toBe('🥁'); // Percussive
        });

        it('should return a fallback emoji for unknown or out-of-range program numbers (boundary condition)', () => {
            // Arrange & Act & Assert
            // -1 will floor to -8, mapping to undefined family, returning fallback '🎵'
            expect(Utils.getInstrumentEmoji(-1)).toBe('🎵');
            expect(Utils.getInstrumentEmoji(128)).toBe('🎵');
        });
    });
});
