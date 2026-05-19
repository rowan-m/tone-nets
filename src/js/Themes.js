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
