import { describe, it, expect, vi } from 'vitest';
import { DefaultTheme, TerminatorTheme } from './Themes.js';

describe('Themes', () => {
    describe('DefaultTheme', () => {
        it('should have correct basic properties', () => {
            expect(DefaultTheme.name).toBe('default');
            expect(DefaultTheme.emoji).toBe('🎨');
            expect(DefaultTheme.background).toBe(0x000000);
        });
    });

    describe('TerminatorTheme', () => {
        it('should have correct basic properties', () => {
            expect(TerminatorTheme.name).toBe('terminator');
            expect(TerminatorTheme.emoji).toBe('💀');
            expect(TerminatorTheme.background).toBe(0x110000);
        });

        it('should calculate node color correctly', () => {
            const pc = 0; // C
            const color = TerminatorTheme.getNodeColor(pc);
            expect(color.hue).toBe(0);
            expect(color.saturation).toBe(0.1);
            expect(color.lightness).toBe(0.8);

            const pc6 = 6; // F#
            const color6 = TerminatorTheme.getNodeColor(pc6);
            expect(color6.hue).toBe(0.5);
        });

        it('should handle activation and deactivation', () => {
            const mockVisualizer = {
                effects: {
                    enableTerminatorBackground: vi.fn(),
                },
            };

            TerminatorTheme.onActivate(mockVisualizer);
            expect(
                mockVisualizer.effects.enableTerminatorBackground,
            ).toHaveBeenCalledWith(true);

            TerminatorTheme.onDeactivate(mockVisualizer);
            expect(
                mockVisualizer.effects.enableTerminatorBackground,
            ).toHaveBeenCalledWith(false);
        });
    });
});
