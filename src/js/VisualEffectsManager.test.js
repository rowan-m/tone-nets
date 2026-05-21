import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { VisualEffectsManager } from './VisualEffectsManager.js';

describe('VisualEffectsManager', () => {
    let scene;
    let camera;
    let effectsManager;

    beforeEach(() => {
        // Arrange
        scene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        camera = {
            quaternion: new THREE.Quaternion(),
        };
        effectsManager = new VisualEffectsManager(scene, camera);

        // Mock DOM element creation for emoji canvas
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
    });

    afterEach(() => {
        delete global.document;
    });

    describe('Emoji Lifecycle', () => {
        it('should create and display a new instrument emoji', () => {
            // Arrange
            const position = new THREE.Vector3(10, 20, 30);

            // Act
            effectsManager.showInstrumentEmoji(position, '🎹');

            // Assert
            expect(effectsManager.activeEmojis.length).toBe(1);
            const sprite = effectsManager.activeEmojis[0].sprite;

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
            expect(effectsManager.activeEmojis.length).toBe(2);

            // Act: Force expiration
            effectsManager.activeEmojis[0].life = 0;
            effectsManager.activeEmojis[1].life = 0;
            effectsManager.update(1.0); // Delta forces update loop to check life

            // Assert
            expect(effectsManager.activeEmojis.length).toBe(0);
            expect(effectsManager.emojiPool.length).toBe(2);
            expect(scene.remove).toHaveBeenCalledTimes(2);

            // Act: Show another emoji, should reuse from pool
            effectsManager.showInstrumentEmoji(position, '🎻');

            // Assert
            expect(effectsManager.activeEmojis.length).toBe(1);
            expect(effectsManager.emojiPool.length).toBe(1);
        });

        it('should strictly limit the number of active emojis to maxEmojis (boundary condition)', () => {
            // Arrange
            effectsManager.maxEmojis = 5; // Lower limit for testing
            const pos = new THREE.Vector3();

            // Act
            for (let i = 0; i < 10; i++) {
                effectsManager.showInstrumentEmoji(pos, '🎹');
            }

            // Assert
            expect(effectsManager.activeEmojis.length).toBe(5);
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
            const sprite = effectsManager.activeEmojis[0].sprite;
            expect(sprite.position.y).toBeCloseTo(15, 4);
            expect(sprite.position.x).toBe(0);
        });

        it('should decrease opacity based on life span', () => {
            // Arrange
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite = effectsManager.activeEmojis[0].sprite;
            expect(sprite.material.opacity).toBe(1.0);

            // Act
            const delta = 0.4;
            effectsManager.update(delta); // lifeStep = 0.4 * 1.25 = 0.5

            // Assert
            expect(effectsManager.activeEmojis[0].life).toBeCloseTo(0.5, 4);
            expect(sprite.material.opacity).toBeCloseTo(0.5, 4);
        });
    });

    describe('Texture Caching', () => {
        it('should cache canvas textures for the same emoji', () => {
            // Arrange
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite1 = effectsManager.activeEmojis[0].sprite;
            const tex1 = sprite1.material.map;

            // Act
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite2 = effectsManager.activeEmojis[1].sprite;
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
            const pooledSprite = effectsManager._createEmojiSprite('🎻');
            vi.spyOn(pooledSprite.material, 'dispose');
            effectsManager.emojiPool.push(pooledSprite);

            const activeSprite = effectsManager.activeEmojis[0].sprite;
            vi.spyOn(activeSprite.material, 'dispose');

            // Act
            effectsManager.clear();

            // Assert
            expect(effectsManager.activeEmojis.length).toBe(0);
            expect(effectsManager.emojiPool.length).toBe(0);
            expect(scene.remove).toHaveBeenCalled();
            expect(activeSprite.material.dispose).toHaveBeenCalled();
            expect(pooledSprite.material.dispose).toHaveBeenCalled();
        });
    });
});
