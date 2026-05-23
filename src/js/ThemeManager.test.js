import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeManager } from './ThemeManager.js';

describe('ThemeManager', () => {
    let themeManager;

    beforeEach(() => {
        themeManager = new ThemeManager();
    });

    describe('Initialization', () => {
        it('should have no current theme initially', () => {
            // Act & Assert
            expect(themeManager.getCurrentTheme()).toBeUndefined();
        });

        it('should return undefined for non-existent themes', () => {
            // Act & Assert
            expect(themeManager.getTheme('any')).toBeUndefined();
        });
    });

    describe('registerTheme', () => {
        it('should register a valid theme and apply default properties', () => {
            // Arrange
            const theme = { name: 'minimal-theme' };

            // Act
            themeManager.registerTheme(theme);
            const registered = themeManager.getTheme('minimal-theme');

            // Assert
            expect(registered.name).toBe('minimal-theme');
            expect(registered.highlightColor).toBeDefined();
            expect(registered.background).toBeDefined();
            expect(registered.emoji).toBe('🎨');
        });

        it('should allow overriding default properties', () => {
            // Arrange
            const theme = {
                name: 'custom-theme',
                highlightColor: 0xff0000,
                emoji: '🚀',
            };

            // Act
            themeManager.registerTheme(theme);
            const registered = themeManager.getTheme('custom-theme');

            // Assert
            expect(registered.highlightColor).toBe(0xff0000);
            expect(registered.emoji).toBe('🚀');
        });

        it('should deeply merge nodeMaterial with defaults', () => {
            // Arrange
            const theme = {
                name: 'material-theme',
                nodeMaterial: { roughness: 0.95 },
            };

            // Act
            themeManager.registerTheme(theme);
            const registered = themeManager.getTheme('material-theme');

            // Assert
            expect(registered.nodeMaterial.roughness).toBe(0.95);
            expect(registered.nodeMaterial.metalness).toBe(0.2); // Default value
        });

        it('should set the first registered theme as the current theme', () => {
            // Arrange
            const theme1 = { name: 'theme1' };
            const theme2 = { name: 'theme2' };

            // Act
            themeManager.registerTheme(theme1);
            themeManager.registerTheme(theme2);

            // Assert
            expect(themeManager.getCurrentTheme().name).toBe('theme1');
        });

        it('should throw an error when registering a theme without a name', () => {
            // Arrange
            const invalidTheme = { highlightColor: 0x00ff00 };

            // Act & Assert
            expect(() => themeManager.registerTheme(invalidTheme)).toThrow(
                'Theme must have a name',
            );
        });

        it('should overwrite an existing theme if registered with the same name', () => {
            // Arrange
            themeManager.registerTheme({ name: 'test', emoji: 'A' });

            // Act
            themeManager.registerTheme({ name: 'test', emoji: 'B' });
            const theme = themeManager.getTheme('test');

            // Assert
            expect(theme.emoji).toBe('B');
        });
    });

    describe('setTheme', () => {
        it('should change the current theme to a registered theme', () => {
            // Arrange
            themeManager.registerTheme({ name: 'theme1' });
            themeManager.registerTheme({ name: 'theme2' });

            // Act
            themeManager.setTheme('theme2');

            // Assert
            expect(themeManager.getCurrentTheme().name).toBe('theme2');
        });

        it('should throw an error if the theme name does not exist', () => {
            // Act & Assert
            expect(() => themeManager.setTheme('ghost-theme')).toThrow(
                'Theme "ghost-theme" not found',
            );
        });
    });

    describe('cycleTheme', () => {
        it('should return the next theme name in sequence', () => {
            // Arrange
            themeManager.registerTheme({ name: 't1' });
            themeManager.registerTheme({ name: 't2' });
            themeManager.registerTheme({ name: 't3' });

            // Act & Assert
            themeManager.setTheme('t1');
            expect(themeManager.cycleTheme()).toBe('t2');

            themeManager.setTheme('t2');
            expect(themeManager.cycleTheme()).toBe('t3');

            themeManager.setTheme('t3');
            expect(themeManager.cycleTheme()).toBe('t1');
        });

        it('should return the current theme name if only one theme is registered', () => {
            // Arrange
            themeManager.registerTheme({ name: 'solo' });

            // Act
            const next = themeManager.cycleTheme();

            // Assert
            expect(next).toBe('solo');
        });

        it('should return undefined if no themes are registered', () => {
            // Act
            const next = themeManager.cycleTheme();

            // Assert
            expect(next).toBeUndefined();
        });
    });
});
