import { describe, it, expect, vi } from 'vitest';
import {
    DefaultTheme,
    TerminatorTheme,
    ConstellationTheme,
    TakeOnMeRealTheme,
} from './Themes.js';

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
                    expect(color.saturation).toBeCloseTo(0.1);
                    expect(color.lightness).toBeCloseTo(0.8);
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
                roughness: 0.3,
                metalness: 0.2,
                emissiveIntensity: 1.5,
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
                        setConstellationMode: vi.fn(),
                    },
                };

                ConstellationTheme.onActivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableConstellationBackground,
                ).toHaveBeenCalledWith(true);
                expect(
                    mockVisualizer.effects.setConstellationMode,
                ).toHaveBeenCalledWith(true);
            });

            it('should disable constellation background on deactivation', () => {
                const mockVisualizer = {
                    effects: {
                        enableConstellationBackground: vi.fn(),
                        setConstellationMode: vi.fn(),
                    },
                };

                ConstellationTheme.onDeactivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableConstellationBackground,
                ).toHaveBeenCalledWith(false);
                expect(
                    mockVisualizer.effects.setConstellationMode,
                ).toHaveBeenCalledWith(false);
            });
        });
    });

    describe('TakeOnMeRealTheme', () => {
        it('should define the take-on-me-real aesthetic properties', () => {
            expect(TakeOnMeRealTheme.name).toBe('take-on-me-real');
            expect(TakeOnMeRealTheme.emoji).toBe('📼');
            expect(TakeOnMeRealTheme.background).toBe(0xf4f7f6);
            expect(TakeOnMeRealTheme.highlightColor).toBe(0xff3388);
            expect(TakeOnMeRealTheme.showOutlines).toBe(true);
            expect(TakeOnMeRealTheme.edgeTubeRadius).toBeCloseTo(0.4);
            expect(TakeOnMeRealTheme.nodeMaterial).toEqual({
                roughness: 0.1,
                metalness: 0.05,
                emissiveIntensity: 0.45,
            });
        });

        describe('getNodeColor', () => {
            it('should calculate 80s pastel colors for various pitch classes', () => {
                const testCases = [
                    {
                        pc: 0,
                        expectedHue: 340 / 360,
                        expectedSat: 0.7,
                        expectedLight: 0.75,
                    },
                    {
                        pc: 1,
                        expectedHue: 180 / 360,
                        expectedSat: 0.65,
                        expectedLight: 0.7,
                    },
                ];

                testCases.forEach(
                    ({ pc, expectedHue, expectedSat, expectedLight }) => {
                        const color = TakeOnMeRealTheme.getNodeColor(pc);
                        expect(color.hue).toBeCloseTo(expectedHue);
                        expect(color.saturation).toBeCloseTo(expectedSat);
                        expect(color.lightness).toBeCloseTo(expectedLight);
                    },
                );
            });
        });

        describe('Lifecycle Hooks', () => {
            it('should enable studio background on activation', () => {
                const mockVisualizer = {
                    effects: {
                        enableStudioBackground: vi.fn(),
                    },
                };

                TakeOnMeRealTheme.onActivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableStudioBackground,
                ).toHaveBeenCalledWith(true);
            });

            it('should disable studio background on deactivation', () => {
                const mockVisualizer = {
                    effects: {
                        enableStudioBackground: vi.fn(),
                    },
                };

                TakeOnMeRealTheme.onDeactivate(mockVisualizer);

                expect(
                    mockVisualizer.effects.enableStudioBackground,
                ).toHaveBeenCalledWith(false);
            });
        });
    });
});
