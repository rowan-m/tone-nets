import { describe, it, expect, afterEach, vi } from 'vitest';
import { Utils } from './Utils.js';

describe('Utils', () => {
    describe('isMobile', () => {
        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('should detect mobile by user agent string', () => {
            // Arrange
            vi.stubGlobal('navigator', {
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X)',
            });
            vi.stubGlobal('window', { innerWidth: 1024 });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should detect mobile by narrow window width', () => {
            // Arrange
            vi.stubGlobal('navigator', { userAgent: 'Desktop' });
            vi.stubGlobal('window', { innerWidth: 500 });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should detect mobile by touch pointer capabilities', () => {
            // Arrange
            vi.stubGlobal('navigator', { userAgent: 'Desktop' });
            vi.stubGlobal('window', {
                innerWidth: 1024,
                matchMedia: vi.fn().mockImplementation((query) => ({
                    matches: query === '(pointer: coarse)',
                })),
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should detect mobile by small screen media query', () => {
            // Arrange
            vi.stubGlobal('navigator', { userAgent: 'Desktop' });
            vi.stubGlobal('window', {
                innerWidth: 1024,
                matchMedia: vi.fn().mockImplementation((query) => ({
                    matches: query === '(max-width: 768px)',
                })),
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(true);
        });

        it('should return false for desktop environment', () => {
            // Arrange
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            });
            vi.stubGlobal('window', {
                innerWidth: 1280,
                matchMedia: vi.fn().mockReturnValue({ matches: false }),
            });

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(false);
        });

        it('should handle missing global environment objects safely', () => {
            // Arrange
            vi.stubGlobal('navigator', undefined);
            vi.stubGlobal('window', undefined);

            // Act
            const result = Utils.isMobile();

            // Assert
            expect(result).toBe(false);
        });
    });

    describe('noteToSemitone', () => {
        it('should convert standard musical notes to MIDI semitones', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C4')).toBe(48);
            expect(Utils.noteToSemitone('A4')).toBe(57);
            expect(Utils.noteToSemitone('C5')).toBe(60);
        });

        it('should handle accidentals (sharps and flats)', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C#4')).toBe(49);
            expect(Utils.noteToSemitone('Db4')).toBe(49);
            expect(Utils.noteToSemitone('Bb4')).toBe(58);
            expect(Utils.noteToSemitone('A#4')).toBe(58);
        });

        it('should correctly interpret enharmonic edges (B#, E#, Cb, Fb)', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('B#4')).toBe(48); // B#4 is C4 (48)
            expect(Utils.noteToSemitone('E#4')).toBe(53); // E#4 is F4 (53)
            expect(Utils.noteToSemitone('Cb4')).toBe(59); // Cb4 is B3/B4 edge case (11 + 4*12 = 59)
            expect(Utils.noteToSemitone('Fb4')).toBe(52); // Fb4 is E4 (52)
        });

        it('should default to octave 4 when octave is omitted', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C')).toBe(48);
            expect(Utils.noteToSemitone('G#')).toBe(56);
        });

        it('should support extreme and negative octaves', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('C0')).toBe(0);
            expect(Utils.noteToSemitone('C-1')).toBe(-12);
            expect(Utils.noteToSemitone('C10')).toBe(120);
        });

        it('should be case-insensitive to note names and accidentals', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('c4')).toBe(48);
            expect(Utils.noteToSemitone('EB4')).toBe(51);
            expect(Utils.noteToSemitone('eb4')).toBe(51);
        });

        it('should return 0 for invalid note strings', () => {
            // Arrange & Act & Assert
            expect(Utils.noteToSemitone('H4')).toBe(0);
            expect(Utils.noteToSemitone('Invalid')).toBe(0);
            expect(Utils.noteToSemitone('')).toBe(0);
            expect(Utils.noteToSemitone('C#4.5')).toBe(0);
        });
    });

    describe('midiNoteToName', () => {
        it('should convert MIDI numbers to scientific pitch notation names', () => {
            // Arrange & Act & Assert
            expect(Utils.midiNoteToName(60)).toBe('C4');
            expect(Utils.midiNoteToName(69)).toBe('A4');
            expect(Utils.midiNoteToName(12)).toBe('C0');
            expect(Utils.midiNoteToName(0)).toBe('C-1');
        });

        it('should handle MIDI values at the boundaries of the standard 0-127 range', () => {
            // Arrange & Act & Assert
            expect(Utils.midiNoteToName(127)).toBe('G9');
            expect(Utils.midiNoteToName(128)).toBe('G#9');
            expect(Utils.midiNoteToName(-1)).toBe('B-2');
        });
    });

    describe('getInterval', () => {
        it('should calculate directed pitch class interval modulo 12', () => {
            // Arrange & Act & Assert
            expect(Utils.getInterval('C4', 'C4')).toBe(0);
            expect(Utils.getInterval('C4', 'D4')).toBe(2);
            expect(Utils.getInterval('C4', 'G4')).toBe(7);
            expect(Utils.getInterval('B4', 'C5')).toBe(1);
        });

        it('should handle downward intervals by returning positive modulo 12 results', () => {
            // Arrange & Act & Assert
            expect(Utils.getInterval('G4', 'C4')).toBe(5);
            expect(Utils.getInterval('E4', 'C4')).toBe(8);
        });

        it('should return 0 for invalid note inputs', () => {
            // Arrange & Act & Assert
            expect(Utils.getInterval('C4', 'Invalid')).toBe(0);
            expect(Utils.getInterval('Invalid', 'AlsoInvalid')).toBe(0);
        });
    });

    describe('getIntervalName', () => {
        it('should return correct names for all 12 interval classes', () => {
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

        it('should ignore octave differences for pitch class interval naming', () => {
            // Arrange & Act & Assert
            expect(Utils.getIntervalName('C4', 'C5')).toBe('Perfect Unison');
            expect(Utils.getIntervalName('C4', 'G5')).toBe('Perfect Fifth');
        });
    });

    describe('getInstrumentEmoji', () => {
        it('should return the drum emoji for drum tracks', () => {
            // Arrange & Act & Assert
            expect(Utils.getInstrumentEmoji(0, true)).toBe('🥁');
            expect(Utils.getInstrumentEmoji(42, true)).toBe('🥁');
        });

        it('should return representative emojis for General MIDI program families', () => {
            // Arrange & Act & Assert
            expect(Utils.getInstrumentEmoji(0)).toBe('🎹'); // Piano family
            expect(Utils.getInstrumentEmoji(24)).toBe('🎸'); // Guitar family
            expect(Utils.getInstrumentEmoji(40)).toBe('🎻'); // Strings family
            expect(Utils.getInstrumentEmoji(80)).toBe('⚡'); // Synth Lead
            expect(Utils.getInstrumentEmoji(112)).toBe('🥁'); // Percussive
        });

        it('should return fallback emoji for unknown or invalid program numbers', () => {
            // Arrange & Act & Assert
            expect(Utils.getInstrumentEmoji(-1)).toBe('🎵');
            expect(Utils.getInstrumentEmoji(128)).toBe('🎵');
        });
    });
});
