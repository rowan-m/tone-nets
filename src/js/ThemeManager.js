export class ThemeManager {
    constructor() {
        this.themes = new Map();
        this.currentThemeName = null;
        this.defaultThemeProperties = {
            highlightColor: 0xffe600,
            nodeMaterial: {
                roughness: 0.3,
                metalness: 0.2,
                emissiveIntensity: 0.15,
                envMapIntensity: 0.0,
            },
            background: 0x000000,
            emoji: '🎨',
        };
    }

    registerTheme(theme) {
        if (!theme.name) {
            throw new Error('Theme must have a name');
        }

        const mergedTheme = {
            ...this.defaultThemeProperties,
            ...theme,
            nodeMaterial: {
                ...this.defaultThemeProperties.nodeMaterial,
                ...(theme.nodeMaterial || {}),
            },
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
        const nextThemeName = themeNames[nextIndex];
        this.setTheme(nextThemeName);
        return nextThemeName;
    }
}
