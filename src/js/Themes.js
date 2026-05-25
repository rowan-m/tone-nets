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
