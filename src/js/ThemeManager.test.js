import { describe, it, expect } from 'vitest';
import { ThemeManager } from './ThemeManager.js';

describe('ThemeManager', () => {
    it('should initialize with default properties and no themes', () => {
        const tm = new ThemeManager();
        expect(tm.themes.size).toBe(0);
        expect(tm.currentThemeName).toBeNull();
        expect(tm.defaultThemeProperties.highlightColor).toBe(0xffe600);
    });

    describe('registerTheme', () => {
        it('should register a valid theme and merge with defaults', () => {
            const tm = new ThemeManager();
            const theme = { name: 'test', highlightColor: 0x123456 };
            tm.registerTheme(theme);

            const registered = tm.getTheme('test');
            expect(registered.name).toBe('test');
            expect(registered.highlightColor).toBe(0x123456);
            expect(registered.emoji).toBe('🎨'); // from defaults
            expect(tm.currentThemeName).toBe('test');
        });

        it('should throw error if theme has no name', () => {
            const tm = new ThemeManager();
            expect(() => tm.registerTheme({})).toThrow(
                'Theme must have a name',
            );
        });

        it('should deeply merge nodeMaterial', () => {
            const tm = new ThemeManager();
            const theme = {
                name: 'test',
                nodeMaterial: { roughness: 0.9 },
            };
            tm.registerTheme(theme);

            const registered = tm.getTheme('test');
            expect(registered.nodeMaterial.roughness).toBe(0.9);
            expect(registered.nodeMaterial.metalness).toBe(0.2); // from defaults
        });
    });

    describe('setTheme and getCurrentTheme', () => {
        it('should set current theme and retrieve it', () => {
            const tm = new ThemeManager();
            tm.registerTheme({ name: 't1' });
            tm.registerTheme({ name: 't2' });

            tm.setTheme('t2');
            expect(tm.currentThemeName).toBe('t2');
            expect(tm.getCurrentTheme().name).toBe('t2');
        });

        it('should throw error if setting non-existent theme', () => {
            const tm = new ThemeManager();
            expect(() => tm.setTheme('nope')).toThrow('Theme "nope" not found');
        });
    });

    describe('cycleTheme', () => {
        it('should return the next theme name in sequence', () => {
            const tm = new ThemeManager();
            tm.registerTheme({ name: 't1' });
            tm.registerTheme({ name: 't2' });
            tm.registerTheme({ name: 't3' });

            tm.setTheme('t1');
            expect(tm.cycleTheme()).toBe('t2');

            tm.setTheme('t2');
            expect(tm.cycleTheme()).toBe('t3');

            tm.setTheme('t3');
            expect(tm.cycleTheme()).toBe('t1');
        });
    });
});
