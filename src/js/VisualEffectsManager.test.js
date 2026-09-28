import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { VisualEffectsManager } from './VisualEffectsManager.js';
import { Utils } from './Utils.js';

describe('VisualEffectsManager', () => {
    let scene;
    let camera;
    let effectsManager;

    beforeEach(() => {
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
        it('pre-caches textures for all standard instrument emojis', () => {
            const uniqueEmojis = new Set(
                Object.values(Utils.INSTRUMENT_EMOJIS),
            );
            for (const emoji of uniqueEmojis) {
                expect(effectsManager.emojiTextureCache.has(emoji)).toBe(true);
            }
        });

        it('starts with no active background and null emojiTint', () => {
            expect(effectsManager.activeBackground).toBeNull();
            expect(effectsManager.emojiTint).toBeNull();
        });
    });

    describe('Emoji Management & Generic Tinting', () => {
        it('displays an emoji at the specified position', () => {
            const pos = new THREE.Vector3(1, 2, 3);
            effectsManager.showInstrumentEmoji(pos, '🎹');

            expect(scene.add).toHaveBeenCalled();
            const sprite =
                scene.add.mock.calls[scene.add.mock.calls.length - 1][0];
            expect(sprite).toBeInstanceOf(THREE.Sprite);
            expect(sprite.position.x).toBe(1);
            expect(sprite.position.y).toBe(2);
            expect(sprite.position.z).toBe(3);
        });

        it('reuses emoji sprites from the pool', () => {
            const pos = new THREE.Vector3();
            effectsManager.showInstrumentEmoji(pos, '🎹');
            const sprite1 = effectsManager.emojiPool.active[0].sprite;

            effectsManager.emojiPool.active[0].life = 0;
            effectsManager.update(1.0);

            expect(scene.remove).toHaveBeenCalledWith(sprite1);

            effectsManager.showInstrumentEmoji(pos, '🎹');
            const sprite2 = effectsManager.emojiPool.active[0].sprite;

            expect(sprite1).toBe(sprite2);
        });

        it('creates a new sprite if the pool is empty (covering createFn)', () => {
            effectsManager.emojiPool.pool = [];
            effectsManager.emojiPool.active = [];

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎸');
            expect(effectsManager.emojiPool.active).toHaveLength(1);
            expect(effectsManager.emojiPool.active[0].sprite).toBeInstanceOf(
                THREE.Sprite,
            );
        });

        it('respects the maxActive limit by recycling the oldest emoji', () => {
            effectsManager.emojiPool.maxActive = 2;
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '1️⃣');
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '2️⃣');

            const second = effectsManager.emojiPool.active[1];

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '3️⃣');

            expect(effectsManager.emojiPool.active).toHaveLength(2);
            expect(effectsManager.emojiPool.active[0]).toBe(second);
        });

        it('exposes activeEmojis getter returning the active emoji pool list', () => {
            expect(effectsManager.activeEmojis).toBe(
                effectsManager.emojiPool.active,
            );
            expect(effectsManager.activeEmojis).toHaveLength(0);

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            expect(effectsManager.activeEmojis).toHaveLength(1);
        });

        it('supports arbitrary theme emoji tinting via setEmojiTint', () => {
            effectsManager.setEmojiTint('#00ff44');
            expect(effectsManager.emojiTint).toBe('#00ff44');

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            expect(effectsManager.emojiTextureCache.has('🎹_#00ff44')).toBe(
                true,
            );

            effectsManager.setEmojiTint('#58a6ff');
            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            expect(effectsManager.emojiTextureCache.has('🎹_#58a6ff')).toBe(
                true,
            );

            effectsManager.setEmojiTint(null);
            expect(effectsManager.emojiTint).toBeNull();
        });
    });

    describe('Pluggable Background Lifecycle', () => {
        it('lazily initializes, caches, toggles, updates, and forwards bounds to theme backgrounds', () => {
            const mockGroup = new THREE.Group();
            const mockBg = {
                group: mockGroup,
                update: vi.fn(),
                onGraphBoundsChange: vi.fn(),
                dispose: vi.fn(),
            };
            const customTheme = {
                name: 'custom-bg-theme',
                emojiTint: '#ff00ff',
                createBackground: vi.fn(() => mockBg),
            };

            effectsManager.applyTheme(customTheme);

            expect(effectsManager.emojiTint).toBe('#ff00ff');
            expect(customTheme.createBackground).toHaveBeenCalledOnce();
            expect(scene.add).toHaveBeenCalledWith(mockGroup);
            expect(mockGroup.visible).toBe(true);
            expect(effectsManager.activeBackground).toBe(mockBg);

            // Forward graph bounds
            const center = new THREE.Vector3(10, 20, 30);
            effectsManager.updateGraphBounds(center, 300);
            expect(mockBg.onGraphBoundsChange).toHaveBeenCalledWith(
                center,
                300,
            );

            // Forward frame update
            const freqData = new Uint8Array(16);
            effectsManager.update(0.16, freqData, center, 300);
            expect(mockBg.update).toHaveBeenCalledWith(
                0.16,
                freqData,
                center,
                300,
            );

            // Switch to a theme without a background
            effectsManager.applyTheme({ name: 'plain-theme' });
            expect(mockGroup.visible).toBe(false);
            expect(effectsManager.activeBackground).toBeNull();
            expect(effectsManager.emojiTint).toBeNull();

            // Switch back to customTheme -> reuses cached background without calling createBackground again
            effectsManager.applyTheme(customTheme);
            expect(customTheme.createBackground).toHaveBeenCalledOnce();
            expect(mockGroup.visible).toBe(true);
            expect(effectsManager.activeBackground).toBe(mockBg);
        });
    });

    describe('Animation and Cleanup', () => {
        it('animates emojis upwards relative to camera orientation and fades them out', () => {
            effectsManager.showInstrumentEmoji(
                new THREE.Vector3(0, 0, 0),
                '🎹',
            );
            const sprite = effectsManager.emojiPool.active[0].sprite;

            effectsManager.update(0.1);
            expect(sprite.position.y).toBeGreaterThan(0);
            expect(sprite.material.opacity).toBeCloseTo(1.0 - 0.1 * 1.25);

            effectsManager.update(1.0);
            expect(effectsManager.emojiPool.active).toHaveLength(0);
            expect(scene.remove).toHaveBeenCalledWith(sprite);
        });

        it('disposes of materials, cached backgrounds, and clears the pool on clear() and dispose()', () => {
            const mockGroup = new THREE.Group();
            const mockBg = {
                group: mockGroup,
                dispose: vi.fn(),
            };
            effectsManager.applyTheme({
                name: 'disposable-theme',
                createBackground: () => mockBg,
            });

            effectsManager.showInstrumentEmoji(new THREE.Vector3(), '🎹');
            const sprite = effectsManager.emojiPool.active[0].sprite;
            const disposeSpy = vi.spyOn(sprite.material, 'dispose');

            effectsManager.emojiPool.pool.push({
                sprite: { position: new THREE.Vector3() },
            });

            effectsManager.dispose();

            expect(effectsManager.emojiPool.active).toHaveLength(0);
            expect(effectsManager.emojiPool.pool).toHaveLength(0);
            expect(disposeSpy).toHaveBeenCalled();
            expect(scene.remove).toHaveBeenCalledWith(sprite);
            expect(scene.remove).toHaveBeenCalledWith(mockGroup);
            expect(mockBg.dispose).toHaveBeenCalledOnce();
            expect(effectsManager.activeBackground).toBeNull();
        });
    });
});
