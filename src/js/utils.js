export const INTERVAL_NAMES = [
    'Perfect Unison',
    'Minor Second',
    'Major Second',
    'Minor Third',
    'Major Third',
    'Perfect Fourth',
    'Tritone',
    'Perfect Fifth',
    'Minor Sixth',
    'Major Sixth',
    'Minor Seventh',
    'Major Seventh',
];

// Cache for noteToSemitone to avoid repeated regex and object lookup overhead
const NOTE_CACHE = new Map();

export function noteToSemitone(note) {
    if (NOTE_CACHE.has(note)) return NOTE_CACHE.get(note);

    const pcMap = {
        C: 0,
        'B#': 0,
        'C#': 1,
        DB: 1,
        D: 2,
        'D#': 3,
        EB: 3,
        E: 4,
        FB: 4,
        F: 5,
        'E#': 5,
        'F#': 6,
        GB: 6,
        G: 7,
        'G#': 8,
        AB: 8,
        A: 9,
        'A#': 10,
        BB: 10,
        B: 11,
        CB: 11,
    };

    // eslint-disable-next-line security/detect-unsafe-regex
    const match = note.toUpperCase().match(/^([A-G][#B]?)(-?\d+)?/);
    let result = 0;
    if (match) {
        const pitchClassStr = match[1];

        const val =
            pcMap[pitchClassStr] !== undefined ? pcMap[pitchClassStr] : 0;
        const oct = match[2] ? parseInt(match[2], 10) : 4;
        result = oct * 12 + val;
    }

    NOTE_CACHE.set(note, result);
    return result;
}

export function getInterval(n1, n2) {
    const s1 = noteToSemitone(n1);
    const s2 = noteToSemitone(n2);
    // Difference modulo 12 (directed pitch class interval)
    return (((s2 - s1) % 12) + 12) % 12;
}

export function getIntervalName(n1, n2) {
    const diff = getInterval(n1, n2);
    // eslint-disable-next-line security/detect-object-injection
    return INTERVAL_NAMES[diff];
}

export const INSTRUMENT_EMOJIS = {
    // Piano
    0: '🎹',
    // Chromatic Percussion
    8: '🔔',
    // Organ
    16: '⛪',
    // Guitar
    24: '🎸',
    // Bass
    32: '🎸',
    // Strings
    40: '🎻',
    // Ensemble
    48: '🎻',
    // Brass
    56: '🎺',
    // Reed
    64: '🎷',
    // Pipe
    72: '🎷',
    // Synth Lead
    80: '⌨️',
    // Synth Pad
    88: '☁️',
    // Synth Effects
    96: '✨',
    // Ethnic
    104: '🪕',
    // Percussive
    112: '🥁',
    // Sound Effects
    120: '📢',
    // Drums (Channel 10 special)
    drums: '🥁',
};

export function getInstrumentEmoji(programNumber, isDrums = false) {
    if (isDrums) return INSTRUMENT_EMOJIS['drums'];
    const familyIndex = Math.floor(programNumber / 8) * 8;
    // eslint-disable-next-line security/detect-object-injection
    return INSTRUMENT_EMOJIS[familyIndex] || '🎵';
}
