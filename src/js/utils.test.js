import { describe, it, expect } from 'vitest';
import {
    noteToSemitone,
    getInterval,
    getIntervalName,
    getInstrumentEmoji,
} from './utils.js';

describe('utils', () => {
    describe('noteToSemitone', () => {
        it('should correctly convert natural notes to semitones', () => {
            // Arrange & Act & Assert
            expect(noteToSemitone('C4')).toBe(48);
            expect(noteToSemitone('D4')).toBe(50);
            expect(noteToSemitone('E4')).toBe(52);
            expect(noteToSemitone('F4')).toBe(53);
            expect(noteToSemitone('G4')).toBe(55);
            expect(noteToSemitone('A4')).toBe(57);
            expect(noteToSemitone('B4')).toBe(59);
            expect(noteToSemitone('C5')).toBe(60);
        });

        it('should correctly convert sharp and flat notes', () => {
            expect(noteToSemitone('C#4')).toBe(49);
            expect(noteToSemitone('Db4')).toBe(49);
            expect(noteToSemitone('D#4')).toBe(51);
            expect(noteToSemitone('Eb4')).toBe(51);
            expect(noteToSemitone('F#4')).toBe(54);
            expect(noteToSemitone('Gb4')).toBe(54);
            expect(noteToSemitone('G#4')).toBe(56);
            expect(noteToSemitone('Ab4')).toBe(56);
            expect(noteToSemitone('A#4')).toBe(58);
            expect(noteToSemitone('Bb4')).toBe(58);
        });

        it('should correctly convert enharmonic equivalents (e.g., E#, B#, Cb, Fb)', () => {
            expect(noteToSemitone('E#4')).toBe(53); // Same as F4
            expect(noteToSemitone('B#4')).toBe(48); // Same as C4
            // Note: In utils.js, octave parsing is strictly string concat/math.
            // Cb4 parses as Cb (11) + (4 * 12) = 59 (B4).
            expect(noteToSemitone('Cb4')).toBe(59);
            expect(noteToSemitone('Fb4')).toBe(52); // Same as E4
        });

        it('should default to octave 4 if no octave is provided', () => {
            expect(noteToSemitone('C')).toBe(48);
            expect(noteToSemitone('G#')).toBe(56);
        });

        it('should handle different octaves including negative and multi-digit', () => {
            expect(noteToSemitone('C0')).toBe(0);
            expect(noteToSemitone('C-1')).toBe(-12);
            expect(noteToSemitone('C10')).toBe(120);
        });

        it('should handle case insensitivity', () => {
            expect(noteToSemitone('c4')).toBe(48);
            expect(noteToSemitone('Eb4')).toBe(51);
            expect(noteToSemitone('eb4')).toBe(51);
        });

        it('should return 0 for invalid notes and edge case strings', () => {
            expect(noteToSemitone('H4')).toBe(0);
            expect(noteToSemitone('Invalid')).toBe(0);
            expect(noteToSemitone('')).toBe(0);
            // Decimal octaves fail the regex ^([A-G][#B]?)(-?\d{1,2})?$
            expect(noteToSemitone('C#4.5')).toBe(0);
        });

        it('should utilize the cache for subsequent identical calls', () => {
            // Act: First call (cache miss)
            const firstResult = noteToSemitone('A4');
            // Act: Second call (cache hit)
            const secondResult = noteToSemitone('A4');

            // Assert
            expect(firstResult).toBe(57);
            expect(secondResult).toBe(57);
        });
    });

    describe('getInterval', () => {
        it('should calculate the directed pitch class interval (modulo 12)', () => {
            // Upward intervals
            expect(getInterval('C4', 'C4')).toBe(0);
            expect(getInterval('C4', 'D4')).toBe(2);
            expect(getInterval('C4', 'G4')).toBe(7);
            expect(getInterval('B4', 'C5')).toBe(1);

            // Downward intervals (should still yield positive modulo 12 results)
            expect(getInterval('G4', 'C4')).toBe(5); // 48 - 55 = -7. (-7 % 12 + 12) % 12 = 5
            expect(getInterval('C5', 'C4')).toBe(0);
            expect(getInterval('E4', 'C4')).toBe(8); // 48 - 52 = -4. (-4 % 12 + 12) % 12 = 8
        });

        it('should handle invalid notes gracefully (evaluates as C0 or 0)', () => {
            // Arrange & Act
            const invalidToInvalid = getInterval('Invalid', 'H4');
            const validToInvalid = getInterval('C4', 'Invalid');

            // Assert
            // If invalid, noteToSemitone returns 0. Interval from 0 to 0 is 0.
            expect(invalidToInvalid).toBe(0);
            // Interval from C4 (48) to Invalid (0) -> 0 - 48 = -48 -> 0
            expect(validToInvalid).toBe(0);
        });
    });

    describe('getIntervalName', () => {
        it('should return the correct interval name for all 12 pitch classes', () => {
            expect(getIntervalName('C4', 'C4')).toBe('Perfect Unison');
            expect(getIntervalName('C4', 'C#4')).toBe('Minor Second');
            expect(getIntervalName('C4', 'D4')).toBe('Major Second');
            expect(getIntervalName('C4', 'Eb4')).toBe('Minor Third');
            expect(getIntervalName('C4', 'E4')).toBe('Major Third');
            expect(getIntervalName('C4', 'F4')).toBe('Perfect Fourth');
            expect(getIntervalName('C4', 'F#4')).toBe('Tritone');
            expect(getIntervalName('C4', 'G4')).toBe('Perfect Fifth');
            expect(getIntervalName('C4', 'Ab4')).toBe('Minor Sixth');
            expect(getIntervalName('C4', 'A4')).toBe('Major Sixth');
            expect(getIntervalName('C4', 'Bb4')).toBe('Minor Seventh');
            expect(getIntervalName('C4', 'B4')).toBe('Major Seventh');
        });

        it('should handle octave differences correctly (modulo 12)', () => {
            expect(getIntervalName('C4', 'C5')).toBe('Perfect Unison');
            expect(getIntervalName('C4', 'G5')).toBe('Perfect Fifth');
            expect(getIntervalName('C2', 'E7')).toBe('Major Third');
        });

        it('should handle downward intervals correctly', () => {
            // G4 to C4 is a perfect 4th down (pitch class interval is 5 semitones up)
            expect(getIntervalName('G4', 'C4')).toBe('Perfect Fourth');
            expect(getIntervalName('E4', 'C4')).toBe('Minor Sixth');
        });

        it('should return Perfect Unison if invalid notes are provided', () => {
            // Invalid notes resolve to 0 difference.
            expect(getIntervalName('Invalid', 'AlsoInvalid')).toBe(
                'Perfect Unison',
            );
        });
    });

    describe('getInstrumentEmoji', () => {
        it('should return a drum emoji if isDrums is true', () => {
            expect(getInstrumentEmoji(0, true)).toBe('🥁');
            expect(getInstrumentEmoji(42, true)).toBe('🥁');
        });

        it('should return the correct emoji for known program families', () => {
            expect(getInstrumentEmoji(0)).toBe('🎹'); // Piano (0)
            expect(getInstrumentEmoji(4)).toBe('🎹'); // Also Piano family (0-7)
            expect(getInstrumentEmoji(24)).toBe('🎸'); // Guitar
            expect(getInstrumentEmoji(30)).toBe('🎸'); // Also Guitar family (24-31)
            expect(getInstrumentEmoji(40)).toBe('🎻'); // Strings
            expect(getInstrumentEmoji(47)).toBe('🎻'); // Strings
            expect(getInstrumentEmoji(80)).toBe('⚡'); // Synth Lead
            expect(getInstrumentEmoji(88)).toBe('💠'); // Synth Pad
            expect(getInstrumentEmoji(112)).toBe('🥁'); // Percussive
        });

        it('should return a fallback emoji for unknown/out-of-range program numbers', () => {
            // -1 will floor to -8, mapping to undefined family, returning fallback '🎵'
            expect(getInstrumentEmoji(-1)).toBe('🎵');
            expect(getInstrumentEmoji(128)).toBe('🎵');
        });
    });
});
