import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
    DefaultTheme,
    TerminatorTheme,
    RetroTheme,
    ConstellationTheme,
    TakeOnMeRealTheme,
    BUILT_IN_THEMES,
} from './Themes.js';

describe('Themes', () => {
    it('exports all 5 built-in themes in BUILT_IN_THEMES registry order', () => {
        expect(BUILT_IN_THEMES).toEqual([
            DefaultTheme,
            TerminatorTheme,
            RetroTheme,
            ConstellationTheme,
            TakeOnMeRealTheme,
        ]);
    });

    describe('DefaultTheme', () => {
        it('defines the default aesthetic properties', () => {
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
        it('defines the terminator aesthetic properties', () => {
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

        it('calculates desaturated colors for various pitch classes', () => {
            const testCases = [
                { pc: 0, expectedHue: 0 },
                { pc: 6, expectedHue: 0.5 },
                { pc: 12, expectedHue: 1 },
            ];

            testCases.forEach(({ pc, expectedHue }) => {
                const color = TerminatorTheme.getNodeColor(pc);
                expect(color.hue).toBe(expectedHue);
                expect(color.saturation).toBeCloseTo(0.1);
                expect(color.lightness).toBeCloseTo(0.8);
            });
        });

        it('injects chrome fire reflection shader via nodeShader hook', () => {
            const mockShader = {
                vertexShader: '#include <common>\n#include <begin_vertex>',
                fragmentShader:
                    '#include <common>\n#include <emissivemap_fragment>',
            };

            TerminatorTheme.nodeShader(mockShader);

            expect(mockShader.fragmentShader).toContain('noise_fire');
            expect(mockShader.fragmentShader).toContain('fireColor');
        });

        it('creates, updates, and disposes its fire and ember background', () => {
            const camera = {
                top: 100,
                bottom: -100,
                left: -200,
                right: 200,
                zoom: 2,
            };
            const bg = TerminatorTheme.createBackground({ camera });

            expect(bg.group).toBeInstanceOf(THREE.Group);
            expect(bg.quad).toBeDefined();
            expect(bg.embers).toBeDefined();

            const mockShader = {
                uniforms: {},
                vertexShader: '#include <begin_vertex>',
                fragmentShader: '#include <premultiplied_alpha_fragment>',
            };
            bg.embers.points.material.onBeforeCompile(mockShader);

            bg.update(0.25);
            expect(bg.quad.uniforms.uTime.value).toBeCloseTo(0.25);
            expect(mockShader.uniforms.uTime.value).toBeCloseTo(0.25);
            expect(mockShader.uniforms.uSpread.value).toBe(400);

            const quadDispose = vi.spyOn(bg.quad, 'dispose');
            const embersDispose = vi.spyOn(bg.embers, 'dispose');
            bg.dispose();
            expect(quadDispose).toHaveBeenCalledOnce();
            expect(embersDispose).toHaveBeenCalledOnce();
        });
    });

    describe('RetroTheme', () => {
        it('defines the retro aesthetic and post-processing properties', () => {
            expect(RetroTheme.name).toBe('retro');
            expect(RetroTheme.emoji).toBe('📟');
            expect(RetroTheme.emojiTint).toBe('#00ff44');
            expect(RetroTheme.background).toBe(0x000500);
            expect(RetroTheme.highlightColor).toBe(0x00ff44);
            expect(RetroTheme.showOutlines).toBe(false);
            expect(RetroTheme.maxResolution).toEqual({
                width: 640,
                height: 480,
            });
            expect(RetroTheme.geometrySegments).toBe(6);
            expect(RetroTheme.nodeMaterial.wireframe).toBe(true);

            const effects = RetroTheme.postProcessing.createEffects();
            expect(effects).toHaveLength(1);
            expect(effects[0].name).toBe('RetroCRTEffect');
        });

        it('calculates terminal green shades for various pitch classes', () => {
            const c0 = RetroTheme.getNodeColor(0);
            expect(c0.hue).toBeCloseTo(120 / 360);
            expect(c0.saturation).toBeCloseTo(0.8);
            expect(c0.lightness).toBeCloseTo(0.3);

            const c6 = RetroTheme.getNodeColor(6);
            expect(c6.hue).toBeCloseTo(120 / 360);
            expect(c6.saturation).toBeCloseTo(0.8);
            expect(c6.lightness).toBeCloseTo(0.5);
        });

        it('creates, updates, and disposes its equalizer background', () => {
            const bg = RetroTheme.createBackground();
            expect(bg.group).toBeInstanceOf(THREE.Group);

            const freqData = new Uint8Array(128).fill(200);
            bg.update(0.1, freqData);
            expect(bg.analyzer.freqData.some((v) => v > 0)).toBe(true);

            const quadDispose = vi.spyOn(bg.quad, 'dispose');
            const analyzerDispose = vi.spyOn(bg.analyzer, 'dispose');
            bg.dispose();
            expect(quadDispose).toHaveBeenCalledOnce();
            expect(analyzerDispose).toHaveBeenCalledOnce();
        });
    });

    describe('ConstellationTheme', () => {
        it('defines the constellation aesthetic, HDR bloom, and highlight strategies', () => {
            expect(ConstellationTheme.name).toBe('constellation');
            expect(ConstellationTheme.emoji).toBe('🌌');
            expect(ConstellationTheme.emojiTint).toBe('#58a6ff');
            expect(ConstellationTheme.background).toBe(0x00020a);
            expect(ConstellationTheme.highlightColor).toBe(0xffd700);
            expect(ConstellationTheme.showOutlines).toBe(false);
            expect(ConstellationTheme.nodeMaterial).toEqual({
                roughness: 0.3,
                metalness: 0.2,
                emissiveIntensity: 1.5,
                transparent: true,
            });
            expect(ConstellationTheme.nodeHighlight).toEqual({
                useBaseColor: true,
                intensityMultiplier: 1.5,
                activeEmissiveIntensity: 1.5,
            });
            expect(ConstellationTheme.edges.palette).toEqual({
                low: 0x0a1630,
                high: 0x182c50,
            });
            expect(ConstellationTheme.edges.highlight).toEqual({
                useWeightColor: true,
                intensityMultiplier: 1.5,
            });
            expect(ConstellationTheme.postProcessing.hdrBuffer).toBe(true);
            expect(ConstellationTheme.postProcessing.bloom).toEqual({
                intensity: 5.5,
                threshold: 0.15,
            });
        });

        it('calculates luminous celestial colors for various pitch classes', () => {
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

        it('injects star corona and diffraction spike shader via nodeShader hook', () => {
            const mockShader = {
                vertexShader: '#include <common>\n#include <begin_vertex>',
                fragmentShader:
                    '#include <common>\n#include <emissivemap_fragment>',
            };

            ConstellationTheme.nodeShader(mockShader);

            expect(mockShader.vertexShader).toContain('transformed *= 0.45');
            expect(mockShader.fragmentShader).toContain('spikeColor');
        });

        it('creates, updates with camera/graphCenter tracking, and disposes its celestial background', () => {
            const camera = {
                position: new THREE.Vector3(500, -300, 150),
                quaternion: new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    Math.PI / 2,
                ),
                zoom: 2.0,
            };
            const bg = ConstellationTheme.createBackground({ camera });

            const mockShader = {
                uniforms: {},
                vertexShader: '#include <begin_vertex>',
                fragmentShader: '#include <premultiplied_alpha_fragment>',
            };
            bg.stars.points.material.onBeforeCompile(mockShader);

            const graphCenter = new THREE.Vector3(100, 200, 300);
            bg.update(0.2, null, graphCenter, 1200);

            expect(bg.group.position.x).toBe(100);
            expect(bg.sphere.position.x).toBe(400);
            expect(bg.sphere.scale.x).toBeCloseTo(0.5);
            expect(bg.sphere.material.uniforms.uTime.value).toBeCloseTo(0.2);
            expect(mockShader.uniforms.uSpread.value).toBe(3600);

            // Fallback branch when camera has no position and graphCenter is null
            bg.camera = { quaternion: new THREE.Quaternion() };
            bg.update(0.1, null, null, null);
            expect(bg.group.position.x).toBe(0);
            expect(bg.sphere.position.x).toBe(0);
            expect(bg.sphere.scale.x).toBe(1.0);

            const starsDispose = vi.spyOn(bg.stars, 'dispose');
            bg.dispose();
            expect(starsDispose).toHaveBeenCalledOnce();
        });
    });

    describe('TakeOnMeRealTheme', () => {
        it('defines the take-on-me-real aesthetic, tube edges, bloom, and post-processing', () => {
            expect(TakeOnMeRealTheme.name).toBe('take-on-me-real');
            expect(TakeOnMeRealTheme.emoji).toBe('📼');
            expect(TakeOnMeRealTheme.background).toBe(0xf4f7f6);
            expect(TakeOnMeRealTheme.highlightColor).toBe(0xff3388);
            expect(TakeOnMeRealTheme.showOutlines).toBe(true);
            expect(TakeOnMeRealTheme.edgeTubeRadius).toBeCloseTo(0.4);
            expect(TakeOnMeRealTheme.edges.renderMode).toBe('tubes');
            expect(TakeOnMeRealTheme.edges.tubeRadius).toBeCloseTo(0.4);
            expect(TakeOnMeRealTheme.edges.palette).toEqual({
                low: 0xd0e8eb,
                high: 0x5cb3b1,
            });
            expect(TakeOnMeRealTheme.postProcessing.bloom).toEqual({
                intensity: 1.0,
                threshold: 0.9,
            });

            const effects = TakeOnMeRealTheme.postProcessing.createEffects();
            expect(effects).toHaveLength(1);
            expect(effects[0].name).toBe('CharcoalSketchEffect');
        });

        it('calculates 80s pastel colors for various pitch classes', () => {
            const c0 = TakeOnMeRealTheme.getNodeColor(0);
            expect(c0.hue).toBeCloseTo(340 / 360);
            expect(c0.saturation).toBeCloseTo(0.7);
            expect(c0.lightness).toBeCloseTo(0.75);

            const c1 = TakeOnMeRealTheme.getNodeColor(1);
            expect(c1.hue).toBeCloseTo(180 / 360);
            expect(c1.saturation).toBeCloseTo(0.65);
            expect(c1.lightness).toBeCloseTo(0.7);
        });

        it('creates, updates graph bounds and audio-reactive neon glow, and disposes its studio background', () => {
            const camera = {
                position: new THREE.Vector3(0, 0, 100),
                quaternion: new THREE.Quaternion(),
                top: 100,
                bottom: -100,
                zoom: 1.0,
            };
            const bg = TakeOnMeRealTheme.createBackground({ camera });

            bg.onGraphBoundsChange(new THREE.Vector3(10, 20, 30), 300);
            expect(bg.group.position.x).toBe(10);
            expect(bg.grid.position.y).toBeCloseTo(-330);

            const freqData = new Uint8Array(64).fill(128);
            bg.update(0.2, freqData);

            expect(bg.quad.uniforms.uTime.value).toBeCloseTo(0.2);
            expect(bg.quad.uniforms.uNeonGlow.value.r).toBeGreaterThan(0);

            const quadDispose = vi.spyOn(bg.quad, 'dispose');
            bg.dispose();
            expect(quadDispose).toHaveBeenCalledOnce();
        });
    });
});
