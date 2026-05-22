import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { VisualEffectsManager } from './VisualEffectsManager.js';
import { Utils } from './Utils.js';

describe('VisualEffectsManager', () => {
    let scene;
    let camera;
    let effectsManager;

    beforeEach(() => {
        // Mock DOM element creation for emoji canvas (must be done before constructing the manager)
        global.document = {
            createElement: vi.fn(() => ({
                getContext: vi.fn(() => ({
                    fillText: vi.fn(),
                    measureText: vi.fn(() => ({ width: 10 })),
                })),
                width: 0,
                height: 0,
            })),
        };

        scene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        camera = {
            quaternion: new THREE.Quaternion(),
        };
        effectsManager = new VisualEffectsManager(scene, camera);
    });

    afterEach(() => {
        delete global.document;
    });

    describe('Warm-up and Initialization Optimization', () => {
        it('should pre-cache textures for all instrument emojis on creation', () => {
            // Check that all emojis from Utils.INSTRUMENT_EMOJIS are cached
            const uniqueEmojis = new Set(
                Object.values(Utils.INSTRUMENT_EMOJIS),
            );
            for (const emoji of uniqueEmojis) {
                expect(effectsManager.emojiTextureCache.has(emoji)).toBe(true);
            }
        });

        it('should pre-populate the emoji pool with inactive sprites to avoid runtime allocation', () => {
            // Check that the pool is pre-populated with 40 inactive sprites
            expect(effectsManager.emojiPool.pool.length).toBe(40);
            expect(effectsManager.emojiPool.active.length).toBe(0);
        });
    });

    describe('Emoji Lifecycle', () => {
        it('should create and display a new instrument emoji', () => {
            // Arrange
            const position = new THREE.Vector3(10, 20, 30);

            // Act
            effectsManager.showInstrumentEmoji(position, '🎹');

            // Assert
            expect(effectsManager.emojiPool.active.length).toBe(1);
            const sprite = effectsManager.emojiPool.active[0].sprite;

            expect(sprite.position.x).toBe(10);
            expect(sprite.position.y).toBe(20);
            expect(sprite.position.z).toBe(30);
            expect(sprite.scale.x).toBe(40); // default scale
            expect(scene.add).toHaveBeenCalledWith(sprite);
        });

        it('should pool and reuse emoji sprites', () => {
            // Arrange
            const position = new THREE.Vector3(0, 0, 0);

            // Show 2 emojis
            effectsManager.showInstrumentEmoji(position, '🎹');
            effectsManager.showInstrumentEmoji(position, '🎸');
            expect(effectsManager.emojiPool.active.length).toBe(2);

            // Act: Force expiration
            effectsManager.emojiPool.active[0].life = 0;
            effectsManager.emojiPool.active[1].life = 0;
            effectsManager.update(1.0); // Delta forces update loop to check life

            // Assert
            expect(effectsManager.emojiPool.active.length).toBe(0);
            expect(effectsManager.emojiPool.pool.length).toBe(40);
            expect(scene.remove).toHaveBeenCalledTimes(2);

            // Act: Show another emoji, should reuse from pool
            effectsManager.showInstrumentEmoji(position, '🎻');

            // Assert
            expect(effectsManager.emojiPool.active.length).toBe(1);
            expect(effectsManager.emojiPool.pool.length).toBe(39);
        });

        it('should strictly limit the number of active emojis to maxEmojis (boundary condition)', () => {
            // Arrange
            effectsManager.emojiPool.maxActive = 5; // Lower limit for testing
            const pos = new THREE.Vector3();

            // Act
            for (let i = 0; i < 10; i++) {
                effectsManager.showInstrumentEmoji(pos, '🎹');
            }

            // Assert
            expect(effectsManager.emojiPool.active.length).toBe(5);
        });
    });

    describe('Animation and Updates', () => {
        it('should update emoji positions relative to camera up-vector', () => {
            // Arrange
            const startPos = new THREE.Vector3(0, 0, 0);
            effectsManager.showInstrumentEmoji(startPos, '🎹');

            // Set camera "up" to point perfectly on Y axis
            camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0);

            // Act
            const delta = 0.5;
            effectsManager.update(delta); // moveStep = 0.5 * 30 = 15

            // Assert
            const sprite = effectsManager.emojiPool.active[0].sprite;
            expect(sprite.position.y).toBeCloseTo(15, 4);
            expect(sprite.position.x).toBe(0);
        });

        it('should decrease opacity based on life span', () => {
            // Arrange
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite = effectsManager.emojiPool.active[0].sprite;
            expect(sprite.material.opacity).toBe(1.0);

            // Act
            const delta = 0.4;
            effectsManager.update(delta); // lifeStep = 0.4 * 1.25 = 0.5

            // Assert
            expect(effectsManager.emojiPool.active[0].life).toBeCloseTo(0.5, 4);
            expect(sprite.material.opacity).toBeCloseTo(0.5, 4);
        });
    });

    describe('Texture Caching', () => {
        it('should cache canvas textures for the same emoji', () => {
            // Arrange
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite1 = effectsManager.emojiPool.active[0].sprite;
            const tex1 = sprite1.material.map;

            // Act
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite2 = effectsManager.emojiPool.active[1].sprite;
            const tex2 = sprite2.material.map;

            // Assert
            expect(tex1).toBe(tex2); // Should be exactly the same reference
        });
    });

    describe('Background Effects', () => {
        it('should initialize terminator background group', () => {
            expect(effectsManager.terminatorGroup).toBeDefined();
            expect(effectsManager.terminatorGroup.visible).toBe(false);
        });

        it('should enable and disable terminator background', () => {
            effectsManager.enableTerminatorBackground(true);
            expect(effectsManager.terminatorGroup.visible).toBe(true);
            effectsManager.enableTerminatorBackground(false);
            expect(effectsManager.terminatorGroup.visible).toBe(false);
        });
    });

    describe('Cleanup', () => {
        it('should completely dispose of active and pooled emojis on clear()', () => {
            // Arrange
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎸');

            // Push one to pool manually to simulate usage
            const pooledItem = effectsManager._createEmojiSprite('🎻');
            vi.spyOn(pooledItem.sprite.material, 'dispose');
            effectsManager.emojiPool.pool.push(pooledItem);

            const activeSprite = effectsManager.emojiPool.active[0].sprite;
            vi.spyOn(activeSprite.material, 'dispose');

            // Act
            effectsManager.clear();

            // Assert
            expect(effectsManager.emojiPool.active.length).toBe(0);
            expect(effectsManager.emojiPool.pool.length).toBe(0);
            expect(scene.remove).toHaveBeenCalled();
            expect(activeSprite.material.dispose).toHaveBeenCalled();
            expect(pooledItem.sprite.material.dispose).toHaveBeenCalled();
        });
    });
});
