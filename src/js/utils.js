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

export function noteToSemitone(note) {
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
    if (!match) return 0;

    const pitchClassStr = match[1];
    // eslint-disable-next-line security/detect-object-injection
    const val = pcMap[pitchClassStr] !== undefined ? pcMap[pitchClassStr] : 0;
    const oct = match[2] ? parseInt(match[2], 10) : 4;

    return oct * 12 + val;
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
