export class ThemeManager {
    constructor() {
        this.themes = new Map();
        this.currentThemeName = null;
        this.defaultThemeProperties = {
            highlightColor: 0xffe600,
            background: 0x000000,
            emoji: '🎨',
            emojiTint: null,
            showOutlines: true,
            maxResolution: null,
            geometrySegments: 32,
            nodeMaterial: {
                roughness: 0.3,
                metalness: 0.2,
                emissiveIntensity: 0.15,
                envMapIntensity: 0.0,
                wireframe: false,
                transparent: false,
            },
            nodeHighlight: {
                useBaseColor: false,
                intensityMultiplier: 1.0,
                activeEmissiveIntensity: 1.0,
            },
            nodeShader: null,
            edges: {
                renderMode: 'lines',
                tubeRadius: 0.4,
                palette: null,
                highlight: {
                    useWeightColor: false,
                    intensityMultiplier: 1.0,
                },
            },
            postProcessing: {
                hdrBuffer: false,
                bloom: {
                    intensity: 3.0,
                    threshold: 0.15,
                },
                createEffects: null,
            },
            createBackground: null,
        };
    }

    registerTheme(theme) {
        if (!theme.name) {
            throw new Error('Theme must have a name');
        }

        const mergedEdges = {
            ...this.defaultThemeProperties.edges,
            ...(theme.edges || {}),
            highlight: {
                ...this.defaultThemeProperties.edges.highlight,
                ...(theme.edges && theme.edges.highlight
                    ? theme.edges.highlight
                    : {}),
            },
        };

        if (
            theme.edgeTubeRadius !== undefined &&
            (!theme.edges || theme.edges.tubeRadius === undefined)
        ) {
            mergedEdges.tubeRadius = theme.edgeTubeRadius;
        }

        const mergedPostProcessing = {
            ...this.defaultThemeProperties.postProcessing,
            ...(theme.postProcessing || {}),
            bloom: {
                ...this.defaultThemeProperties.postProcessing.bloom,
                ...(theme.postProcessing && theme.postProcessing.bloom
                    ? theme.postProcessing.bloom
                    : {}),
            },
        };

        const mergedTheme = {
            ...this.defaultThemeProperties,
            ...theme,
            nodeMaterial: {
                ...this.defaultThemeProperties.nodeMaterial,
                ...(theme.nodeMaterial || {}),
            },
            nodeHighlight: {
                ...this.defaultThemeProperties.nodeHighlight,
                ...(theme.nodeHighlight || {}),
            },
            edges: mergedEdges,
            postProcessing: mergedPostProcessing,
        };

        this.themes.set(theme.name, mergedTheme);

        if (!this.currentThemeName) {
            this.currentThemeName = theme.name;
        }
    }

    getTheme(name) {
        return this.themes.get(name);
    }

    setTheme(name) {
        if (!this.themes.has(name)) {
            throw new Error(`Theme "${name}" not found`);
        }
        this.currentThemeName = name;
    }

    getCurrentTheme() {
        return this.themes.get(this.currentThemeName);
    }

    cycleTheme() {
        const themeNames = Array.from(this.themes.keys());
        const currentIndex = themeNames.indexOf(this.currentThemeName);
        const nextIndex = (currentIndex + 1) % themeNames.length;
        return themeNames[nextIndex];
    }
}
