import { describe, it, expect, vi } from 'vitest';
import { DefaultTheme, TerminatorTheme, ConstellationTheme } from './Themes.js';

describe('Themes', () => {
    describe('DefaultTheme', () => {
        it('should define the default aesthetic properties', () => {
            // Arrange & Act (Accessing static theme object)

            // Assert
            expect(DefaultTheme.name).toBe('default');
            expect(DefaultTheme.emoji).toBe('🎨');
            expect(DefaultTheme.background).toBe(0x000000);
            expect(DefaultTheme.highlightColor).toBe(0xffe600);
            expect(DefaultTheme.nodeMaterial).toEqual({
                roughness: 0.3,
                metalness: 0.2,
                emissiveIntensity: 0.15,
                envMapIntensity: 0.0,
            });
        });
    });

    describe('TerminatorTheme', () => {
        it('should define the terminator aesthetic properties', () => {
            // Assert
            expect(TerminatorTheme.name).toBe('terminator');
            expect(TerminatorTheme.emoji).toBe('💀');
            expect(TerminatorTheme.background).toBe(0x110000);
            expect(TerminatorTheme.highlightColor).toBe(0x00aaff);
            expect(TerminatorTheme.nodeMaterial).toEqual({
                roughness: 0.05,
                metalness: 1.0,
                emissiveIntensity: 0.25,
                envMapIntensity: 1.5,
            });
        });

        describe('getNodeColor', () => {
            it('should calculate desaturated colors for various pitch classes', () => {
                // Arrange
                const testCases = [
                    { pc: 0, expectedHue: 0 },
                    { pc: 6, expectedHue: 0.5 },
                    { pc: 12, expectedHue: 1 }, // Boundary/Extreme case (though usually 0-11)
                ];

                testCases.forEach(({ pc, expectedHue }) => {
                    // Act
                    const color = TerminatorTheme.getNodeColor(pc);

                    // Assert
                    expect(color.hue).toBe(expectedHue);
                    expect(color.saturation).toBe(0.1);
                    expect(color.lightness).toBe(0.8);
                });
            });
        });

        describe('Lifecycle Hooks', () => {
            it('should enable terminator background on activation', () => {
                // Arrange
                const mockVisualizer = {
                    effects: {
                        enableTerminatorBackground: vi.fn(),
                    },
                };

                // Act
                TerminatorTheme.onActivate(mockVisualizer);

                // Assert
                expect(
                    mockVisualizer.effects.enableTerminatorBackground,
                ).toHaveBeenCalledWith(true);
            });

            it('should disable terminator background on deactivation', () => {
                // Arrange
                const mockVisualizer = {
                    effects: {
                        enableTerminatorBackground: vi.fn(),
                    },
                };

                // Act
                TerminatorTheme.onDeactivate(mockVisualizer);

                // Assert
                expect(
                    mockVisualizer.effects.enableTerminatorBackground,
                ).toHaveBeenCalledWith(false);
            });
        });
    });

    describe('RetroTheme', () => {
        it('should define the retro aesthetic properties', () => {
            const { RetroTheme } = require('./Themes.js');
            expect(RetroTheme.name).toBe('retro');
            expect(RetroTheme.emoji).toBe('📟');
            expect(RetroTheme.background).toBe(0x000500);
            expect(RetroTheme.highlightColor).toBe(0x00ff44);
            expect(RetroTheme.showOutlines).toBe(false);
            expect(RetroTheme.maxResolution).toEqual({
                width: 640,
                height: 480,
            });
            expect(RetroTheme.nodeMaterial.wireframe).toBe(true);
        });

        describe('Lifecycle Hooks', () => {
            it('should enable retro effects on activation', () => {
                const { RetroTheme } = require('./Themes.js');
                const mockVisualizer = {
                    enableRetroEffects: vi.fn(),
                    effects: {
                        enableRetroBackground: vi.fn(),
                    },
                };

                RetroTheme.onActivate(mockVisualizer);

                expect(mockVisualizer.enableRetroEffects).toHaveBeenCalledWith(
                    true,
                );
                expect(
                    mockVisualizer.effects.enableRetroBackground,
                ).toHaveBeenCalledWith(true);
            });

            it('should disable retro effects on deactivation', () => {
                const { RetroTheme } = require('./Themes.js');
                const mockVisualizer = {
                    enableRetroEffects: vi.fn(),
                    effects: {
                        enableRetroBackground: vi.fn(),
                    },
                };

                RetroTheme.onDeactivate(mockVisualizer);

                expect(mockVisualizer.enableRetroEffects).toHaveBeenCalledWith(
                    false,
                );
                expect(
                    mockVisualizer.effects.enableRetroBackground,
                ).toHaveBeenCalledWith(false);
            });
        });
    });

    describe('ConstellationTheme', () => {
        it('should define the constellation aesthetic properties', () => {
            expect(ConstellationTheme.name).toBe('constellation');
            expect(ConstellationTheme.emoji).toBe('🌌');
            expect(ConstellationTheme.background).toBe(0x00020a);
            expect(ConstellationTheme.highlightColor).toBe(0xffd700);
            expect(ConstellationTheme.showOutlines).toBe(false);
            expect(ConstellationTheme.nodeMaterial).toEqual({
                roughness: 1.0,
                metalness: 0.0,
                emissiveIntensity: 1.8,
            });
        });

        describe('getNodeColor', () => {
            it('should calculate luminous celestial colors for various pitch classes', () => {
                const testCases = [
                    { pc: 0, expectedHue: 0 },
                    { pc: 6, expectedHue: 0.5 },
                ];

                testCases.forEach(({ pc, expectedHue }) => {
                    const color = ConstellationTheme.getNodeColor(pc);
                    expect(color.hue).toBeCloseTo(expectedHue);
                    expect(color.saturation).toBeCloseTo(0.6);
                    expect(color.lightness).toBeCloseTo(0.7);
                });
            });
        });

        describe('Lifecycle Hooks', () => {
            it('should enable constellation background on activation', () => {
                const mockVisualizer = {
                    effects: {
                        enableConstellationBackground: vi.fn(),
                    },
                };

                ConstellationTheme.onActivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableConstellationBackground,
                ).toHaveBeenCalledWith(true);
            });

            it('should disable constellation background on deactivation', () => {
                const mockVisualizer = {
                    effects: {
                        enableConstellationBackground: vi.fn(),
                    },
                };

                ConstellationTheme.onDeactivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableConstellationBackground,
                ).toHaveBeenCalledWith(false);
            });
        });
    });
});
