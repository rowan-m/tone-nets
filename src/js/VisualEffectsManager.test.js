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
            expect(effectsManager.emojiPool.active.length).toBe(1);
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

            expect(effectsManager.emojiPool.active.length).toBe(2);
            // The oldest ('1️⃣') should have been released, so '2️⃣' is now at index 0
            expect(effectsManager.emojiPool.active[0]).toBe(second);
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
            expect(effectsManager.emojiPool.active.length).toBe(0);
            expect(scene.remove).toHaveBeenCalledWith(sprite);
        });

        it('should update terminator background uniforms when visible', () => {
            effectsManager.enableTerminatorBackground(true);

            // Test branch where particleShader is NOT yet set
            effectsManager.update(0.1);
            expect(
                effectsManager.terminatorSphere.material.uniforms.uTime.value,
            ).toBe(0.1);

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

            expect(effectsManager.emojiPool.active.length).toBe(0);
            expect(effectsManager.emojiPool.pool.length).toBe(0);
            expect(disposeSpy).toHaveBeenCalled();
            expect(scene.remove).toHaveBeenCalledWith(sprite);
        });
    });
});
