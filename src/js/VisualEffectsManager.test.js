import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { VisualEffectsManager } from './VisualEffectsManager.js';
import { Utils } from './Utils.js';

describe('VisualEffectsManager', () => {
    let scene;
    let camera;
    let effectsManager;

    beforeEach(() => {
        // Mock DOM element creation for emoji canvas
        global.document = {
            createElement: vi.fn((tag) => {
                if (tag === 'canvas') {
                    return {
                        getContext: vi.fn(() => ({
                            fillText: vi.fn(),
                            measureText: vi.fn(() => ({ width: 10 })),
                            fillRect: vi.fn(),
                            globalCompositeOperation: '',
                            fillStyle: '',
                            filter: '',
                        })),
                        width: 0,
                        height: 0,
                    };
                }
                return {};
            }),
        };

        scene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        camera = {
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            top: 100,
            bottom: -100,
            left: -100,
            right: 100,
            zoom: 1,
        };
        effectsManager = new VisualEffectsManager(scene, camera);
    });

    afterEach(() => {
        delete global.document;
    });

    describe('Initialization', () => {
        it('should pre-cache textures for all standard instrument emojis', () => {
            const uniqueEmojis = new Set(
                Object.values(Utils.INSTRUMENT_EMOJIS),
            );
            for (const emoji of uniqueEmojis) {
                expect(effectsManager.emojiTextureCache.has(emoji)).toBe(true);
            }
        });

        it('should initialize with a hidden terminator background group', () => {
            expect(effectsManager.terminatorGroup).toBeInstanceOf(THREE.Group);
            expect(effectsManager.terminatorGroup.visible).toBe(false);
            expect(scene.add).toHaveBeenCalledWith(
                effectsManager.terminatorGroup,
            );
        });
    });

    describe('Emoji Management', () => {
        it('should display an emoji at the specified position', () => {
            const pos = new THREE.Vector3(1, 2, 3);
            effectsManager.showInstrumentEmoji(pos, '🎹');

            expect(scene.add).toHaveBeenCalled();
            // The last call to scene.add should be the sprite
            const sprite =
                scene.add.mock.calls[scene.add.mock.calls.length - 1][0];
            expect(sprite).toBeInstanceOf(THREE.Sprite);
            expect(sprite.position.x).toBe(1);
            expect(sprite.position.y).toBe(2);
            expect(sprite.position.z).toBe(3);
        });

        it('should reuse emoji sprites from the pool', () => {
            // First, exhaust the 40 pre-allocated sprites and some more to ensure we use the pool
            const pos = new THREE.Vector3();
            effectsManager.showInstrumentEmoji(pos, '🎹');
            const sprite1 = effectsManager.emojiPool.active[0].sprite;

            // Release it
            effectsManager.emojiPool.active[0].life = 0;
            effectsManager.update(1.0);

            expect(scene.remove).toHaveBeenCalledWith(sprite1);

            // Show another one, it should reuse the same sprite instance
            effectsManager.showInstrumentEmoji(pos, '🎹');
            const sprite2 = effectsManager.emojiPool.active[0].sprite;

            expect(sprite1).toBe(sprite2);
        });

        it('should create a new sprite if the pool is empty (covering createFn)', () => {
            // Clear the pool first to force creation
            effectsManager.emojiPool.pool = [];
            effectsManager.emojiPool.active = [];

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎸');
            expect(effectsManager.emojiPool.active).toHaveLength(1);
            expect(effectsManager.emojiPool.active[0].sprite).toBeInstanceOf(
                THREE.Sprite,
            );
        });

        it('should respect the maxActive limit by recycling the oldest emoji', () => {
            effectsManager.emojiPool.maxActive = 2;
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '1️⃣');
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '2️⃣');

            const second = effectsManager.emojiPool.active[1];

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '3️⃣');

            expect(effectsManager.emojiPool.active).toHaveLength(2);
            // The oldest ('1️⃣') should have been released, so '2️⃣' is now at index 0
            expect(effectsManager.emojiPool.active[0]).toBe(second);
        });

        it('should expose activeEmojis getter returning the active emoji pool list', () => {
            expect(effectsManager.activeEmojis).toBe(
                effectsManager.emojiPool.active,
            );
            expect(effectsManager.activeEmojis).toHaveLength(0);

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            expect(effectsManager.activeEmojis).toHaveLength(1);
        });
    });

    describe('Animation and Updates', () => {
        it('should animate emojis upwards relative to camera orientation', () => {
            effectsManager.showInstrumentEmoji(
                new THREE.Vector3(0, 0, 0),
                '🎹',
            );
            const sprite = effectsManager.emojiPool.active[0].sprite;

            // Camera is looking straight ahead, "up" is Y
            effectsManager.update(0.1);

            expect(sprite.position.y).toBeGreaterThan(0);
            expect(sprite.position.x).toBe(0);
            expect(sprite.position.z).toBe(0);
        });

        it('should fade out emojis as they age', () => {
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const item = effectsManager.emojiPool.active[0];
            const sprite = item.sprite;

            expect(sprite.material.opacity).toBe(1.0);

            effectsManager.update(0.4); // life decreases by 0.4 * 1.25 = 0.5
            expect(sprite.material.opacity).toBeCloseTo(0.5);

            effectsManager.update(0.5); // life reaches 0
            expect(effectsManager.emojiPool.active).toHaveLength(0);
            expect(scene.remove).toHaveBeenCalledWith(sprite);
        });

        it('should update terminator background uniforms when visible', () => {
            effectsManager.enableTerminatorBackground(true);

            // Test branch where particleShader is NOT yet set
            effectsManager.update(0.1);
            expect(
                effectsManager.terminatorSphere.material.uniforms.uTime.value,
            ).toBeCloseTo(0.1);

            // Mock the particle shader that is usually set in onBeforeCompile
            const mockShader = {
                uniforms: {
                    uTime: { value: 0.1 },
                    uSpread: { value: 0 },
                },
            };
            effectsManager.particleShader = mockShader;

            effectsManager.update(0.4);

            expect(
                effectsManager.terminatorSphere.material.uniforms.uTime.value,
            ).toBeCloseTo(0.5);
            expect(mockShader.uniforms.uTime.value).toBeCloseTo(0.5);
            expect(mockShader.uniforms.uSpread.value).toBeGreaterThan(0);
        });

        it('should execute shader injection logic in onBeforeCompile', () => {
            const mockShader = {
                uniforms: {},
                vertexShader: '#include <begin_vertex>',
                fragmentShader: '#include <premultiplied_alpha_fragment>',
            };

            // Trigger the onBeforeCompile hook manually
            effectsManager.embers.material.onBeforeCompile(mockShader);

            expect(mockShader.uniforms.uTime).toBeDefined();
            expect(mockShader.uniforms.uSpread).toBeDefined();
            expect(mockShader.vertexShader).toContain('uTime');
            expect(mockShader.vertexShader).toContain('uSpread');
            expect(mockShader.vertexShader).not.toContain(
                '#include <begin_vertex>',
            );
            expect(mockShader.fragmentShader).toContain('radialAlpha');
        });

        it('should support retro mode for emoji textures', () => {
            effectsManager.setRetroMode(true);
            expect(effectsManager.retroMode).toBe(true);

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            // Check if a retro version was cached
            expect(effectsManager.emojiTextureCache.has('🎹_retro')).toBe(true);

            effectsManager.setRetroMode(false);
            expect(effectsManager.retroMode).toBe(false);
        });

        it('should support constellation mode for emoji textures', () => {
            effectsManager.setConstellationMode(true);
            expect(effectsManager.constellationMode).toBe(true);

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            // Check if a constellation version was cached
            expect(
                effectsManager.emojiTextureCache.has('🎹_constellation'),
            ).toBe(true);

            effectsManager.setConstellationMode(false);
            expect(effectsManager.constellationMode).toBe(false);
        });

        it('should toggle constellation group visibility via enableConstellationBackground', () => {
            effectsManager.enableConstellationBackground(true);
            expect(effectsManager.constellationGroup.visible).toBe(true);

            effectsManager.enableConstellationBackground(false);
            expect(effectsManager.constellationGroup.visible).toBe(false);
        });

        it('should update constellation background uniforms when visible', () => {
            effectsManager.enableConstellationBackground(true);

            // Test branch where constellationParticleShader is NOT yet set
            effectsManager.update(0.1);
            expect(
                effectsManager.constellationSphere.material.uniforms.uTime
                    .value,
            ).toBeCloseTo(0.1);

            // Mock the particle shader that is usually set in onBeforeCompile
            const mockShader = {
                uniforms: {
                    uTime: { value: 0.1 },
                    uSpread: { value: 0 },
                },
            };
            effectsManager.constellationParticleShader = mockShader;

            effectsManager.update(0.4);

            expect(
                effectsManager.constellationSphere.material.uniforms.uTime
                    .value,
            ).toBeCloseTo(0.5);
            expect(mockShader.uniforms.uTime.value).toBeCloseTo(0.5);
            expect(mockShader.uniforms.uSpread.value).toBeGreaterThan(0);

            // Pan the camera and check camera-following dynamic positioning update on sphere, and graphCenter positioning on constellationGroup
            effectsManager.camera.position.set(500, -300, 150);
            effectsManager.camera.quaternion.setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.PI / 2,
            );
            effectsManager.camera.zoom = 2.0;
            const mockGraphCenter = new THREE.Vector3(100, 200, 300);
            effectsManager.update(0.1, null, mockGraphCenter);

            // Group should align with graph center (for original particle star behavior)
            expect(effectsManager.constellationGroup.position.x).toBe(100);
            expect(effectsManager.constellationGroup.position.y).toBe(200);
            expect(effectsManager.constellationGroup.position.z).toBe(300);

            // Sphere should be offset to align with camera position in world space
            expect(effectsManager.constellationSphere.position.x).toBe(400); // 500 - 100
            expect(effectsManager.constellationSphere.position.y).toBe(-500); // -300 - 200
            expect(effectsManager.constellationSphere.position.z).toBe(-150); // 150 - 300
            expect(effectsManager.constellationSphere.scale.x).toBeCloseTo(0.5); // 1 / 2.0

            // Sphere should track 90% of camera rotation using slerp
            const expectedQuat = new THREE.Quaternion()
                .set(0, 0, 0, 1)
                .slerp(effectsManager.camera.quaternion, 0.9);
            expect(effectsManager.constellationSphere.quaternion.x).toBeCloseTo(
                expectedQuat.x,
            );
            expect(effectsManager.constellationSphere.quaternion.y).toBeCloseTo(
                expectedQuat.y,
            );
            expect(effectsManager.constellationSphere.quaternion.z).toBeCloseTo(
                expectedQuat.z,
            );
            expect(effectsManager.constellationSphere.quaternion.w).toBeCloseTo(
                expectedQuat.w,
            );

            // Fallback: if camera is not present, use graphCenter
            effectsManager.camera = { quaternion: new THREE.Quaternion() };
            const fallbackGraphCenter = new THREE.Vector3(200, -100, 50);
            effectsManager.update(0.1, null, fallbackGraphCenter);

            expect(effectsManager.constellationGroup.position.x).toBe(200);
            expect(effectsManager.constellationGroup.position.y).toBe(-100);
            expect(effectsManager.constellationGroup.position.z).toBe(50);
            expect(effectsManager.constellationSphere.position.x).toBe(0);
            expect(effectsManager.constellationSphere.position.y).toBe(0);
            expect(effectsManager.constellationSphere.position.z).toBe(0);
            expect(effectsManager.constellationSphere.scale.x).toBe(1.0);
        });

        it('should execute constellation shader injection logic in onBeforeCompile', () => {
            const mockShader = {
                uniforms: {},
                vertexShader: '#include <begin_vertex>',
                fragmentShader: '#include <premultiplied_alpha_fragment>',
            };

            // Trigger the onBeforeCompile hook manually
            effectsManager.constellationStars.material.onBeforeCompile(
                mockShader,
            );

            expect(mockShader.uniforms.uTime).toBeDefined();
            expect(mockShader.uniforms.uSpread).toBeDefined();
            expect(mockShader.vertexShader).toContain('uTime');
            expect(mockShader.vertexShader).not.toContain(
                '#include <begin_vertex>',
            );
            expect(mockShader.fragmentShader).toContain('vTwinkle');
        });

        it('should update studio background grid and neon glow when visible', () => {
            effectsManager.enableStudioBackground(true);
            expect(effectsManager.studioGroup.visible).toBe(true);

            effectsManager.updateStudioPosition(
                new THREE.Vector3(10, 20, 30),
                300,
            );
            expect(effectsManager.studioGroup.position.x).toBe(10);
            expect(effectsManager.studioGrid.position.y).toBeCloseTo(-330);

            const freqData = new Uint8Array(64).fill(128);
            effectsManager.update(0.2, freqData);

            expect(
                effectsManager.studioSphere.material.uniforms.uTime.value,
            ).toBeCloseTo(0.2);
            expect(
                effectsManager.studioSphere.material.uniforms.uNeonGlow.value.r,
            ).toBeGreaterThan(0);

            effectsManager.enableStudioBackground(false);
            expect(effectsManager.studioGroup.visible).toBe(false);
        });

        it('should update retro equalizer frequency data when visible', () => {
            effectsManager.enableRetroBackground(true);
            expect(effectsManager.retroGroup.visible).toBe(true);

            const freqData = new Uint8Array(128).fill(200);
            effectsManager.update(0.1, freqData);
            expect(effectsManager.retroFreqData.some((v) => v > 0)).toBe(true);

            // Decay branch when frequency drops to 0
            const zeroFreq = new Uint8Array(128).fill(0);
            effectsManager.update(0.1, zeroFreq);

            effectsManager.enableRetroBackground(false);
            expect(effectsManager.retroGroup.visible).toBe(false);
        });
    });

    describe('Cleanup', () => {
        it('should dispose of materials and clear the pool on clear()', () => {
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite = effectsManager.emojiPool.active[0].sprite;
            const disposeSpy = vi.spyOn(sprite.material, 'dispose');

            // Force a case where an item has no material to cover branch
            effectsManager.emojiPool.pool.push({
                sprite: { position: new THREE.Vector3() },
            });

            effectsManager.clear();

            expect(effectsManager.emojiPool.active).toHaveLength(0);
            expect(effectsManager.emojiPool.pool).toHaveLength(0);
            expect(disposeSpy).toHaveBeenCalled();
            expect(scene.remove).toHaveBeenCalledWith(sprite);
        });
    });
});
