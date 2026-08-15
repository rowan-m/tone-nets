export const DefaultTheme = {
    name: 'default',
    highlightColor: 0xffe600, // Electric Yellow
    nodeMaterial: {
        roughness: 0.3,
        metalness: 0.2,
        emissiveIntensity: 0.15,
        envMapIntensity: 0.0,
    },
    background: 0x000000,
    emoji: '🎨',
};

export const TerminatorTheme = {
    name: 'terminator',
    highlightColor: 0x00aaff, // Electric Blue
    nodeMaterial: {
        roughness: 0.05,
        metalness: 1.0,
        emissiveIntensity: 0.25,
        envMapIntensity: 1.5,
    },
    background: 0x110000, // Deep Red background base
    emoji: '💀',
    getNodeColor: (pitchClass) => {
        // Terminator theme: mostly chrome, so we use a very desaturated, bright base color
        const hue = pitchClass / 12;
        const saturation = 0.1;
        const lightness = 0.8;
        return { hue, saturation, lightness };
    },
    onActivate: (visualizer) => {
        visualizer.effects.enableTerminatorBackground(true);
    },
    onDeactivate: (visualizer) => {
        visualizer.effects.enableTerminatorBackground(false);
    },
};

export const RetroTheme = {
    name: 'retro',
    highlightColor: 0x00ff44, // Terminal Green
    nodeMaterial: {
        roughness: 1.0,
        metalness: 0.0,
        emissiveIntensity: 0.5,
        wireframe: true,
    },
    background: 0x000500, // Very dark green
    emoji: '📟',
    showOutlines: false,
    maxResolution: { width: 640, height: 480 },
    geometrySegments: 6,
    getNodeColor: (pitchClass) => {
        // Retro theme: shades of green
        const hue = 120 / 360; // Green
        const saturation = 0.8;
        const lightness = 0.3 + (pitchClass / 12) * 0.4;
        return { hue, saturation, lightness };
    },
    onActivate: (visualizer) => {
        visualizer.enableRetroEffects(true);
        visualizer.effects.enableRetroBackground(true);
    },
    onDeactivate: (visualizer) => {
        visualizer.enableRetroEffects(false);
        visualizer.effects.enableRetroBackground(false);
    },
};

export const ConstellationTheme = {
    name: 'constellation',
    highlightColor: 0xffd700, // Twinkling Gold
    nodeMaterial: {
        roughness: 0.3,
        metalness: 0.2,
        emissiveIntensity: 1.5,
    },
    showOutlines: false, // Turn off the black outlines
    background: 0x00020a, // Deep midnight blue
    emoji: '🌌',
    getNodeColor: (pitchClass) => {
        // Luminous celestial colors
        const hue = pitchClass / 12;
        const saturation = 0.6;
        const lightness = 0.7;
        return { hue, saturation, lightness };
    },
    onActivate: (visualizer) => {
        visualizer.effects.enableConstellationBackground(true);
        visualizer.effects.setConstellationMode(true);
    },
    onDeactivate: (visualizer) => {
        visualizer.effects.enableConstellationBackground(false);
        visualizer.effects.setConstellationMode(false);
    },
};

export const TakeOnMeRealTheme = {
    name: 'take-on-me-real',
    highlightColor: 0xff3388, // Vivid Neon Hot Pink (fluorescent)
    nodeMaterial: {
        roughness: 0.1, // Ultra-smooth, high-gloss plastic
        metalness: 0.05, // Non-metallic dielectric plastic look
        emissiveIntensity: 0.45, // Base fluorescent glow from inside the plastic
    },
    showOutlines: true, // Crisp 80s outlines
    edgeTubeRadius: 0.4, // Large diameter 80s neon tube edges
    background: 0xf4f7f6, // Soft studio blue-grey base
    emoji: '📼', // Vintage 80s VHS tape emoji!
    getNodeColor: (pitchClass) => {
        // Retro 80s pastel palette based on pitch class
        const pastels = [
            { hue: 340 / 360, saturation: 0.7, lightness: 0.75 }, // Pastel Pink
            { hue: 180 / 360, saturation: 0.65, lightness: 0.7 }, // Soft Turquoise
            { hue: 270 / 360, saturation: 0.65, lightness: 0.75 }, // Pastel Lavender
            { hue: 25 / 360, saturation: 0.75, lightness: 0.75 }, // Pastel Peach
            { hue: 55 / 360, saturation: 0.7, lightness: 0.78 }, // Lemon Yellow
            { hue: 140 / 360, saturation: 0.6, lightness: 0.75 }, // Soft Mint Green
            { hue: 205 / 360, saturation: 0.7, lightness: 0.75 }, // Powder Blue
            { hue: 310 / 360, saturation: 0.7, lightness: 0.75 }, // Soft Orchid/Magenta
        ];
        return pastels[pitchClass % pastels.length];
    },
    onActivate: (visualizer) => {
        visualizer.effects.enableStudioBackground(true);
    },
    onDeactivate: (visualizer) => {
        visualizer.effects.enableStudioBackground(false);
    },
};
