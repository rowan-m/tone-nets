import * as THREE from 'three';
import { ObjectPool } from './ObjectPool.js';
import { Utils } from './Utils.js';

/**
 * Manages visual feedback like floating emojis and hosts the active theme's background controller.
 * Separated from NetworkVisualizer to follow SRP and completely decoupled from specific themes.
 */
export class VisualEffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.maxEmojis = 100;
        this.emojiTextureCache = new Map();
        this.emojiTint = null;

        this.backgroundCache = new Map();
        this.activeBackground = null;

        this.emojiPool = new ObjectPool(
            (emoji) => this._createEmojiSprite(emoji),
            (item, emoji) => {
                item.sprite.material.map = this._getEmojiTexture(
                    emoji,
                    this.emojiTint,
                );
                item.sprite.material.opacity = 1.0;
                item.life = 1.0;
            },
            (item) => {
                this.scene.remove(item.sprite);
            },
            this.maxEmojis,
        );

        this._cameraUp = new THREE.Vector3();

        if (typeof document !== 'undefined' || global.document) {
            const uniqueEmojis = new Set(
                Object.values(Utils.INSTRUMENT_EMOJIS),
            );
            for (const emoji of uniqueEmojis) {
                this._getEmojiTexture(emoji);
            }

            // Pre-allocate pool to avoid jank without breaking encapsulation
            const initialItems = [];
            for (let i = 0; i < 40; i++) {
                initialItems.push(this.emojiPool.acquire('🎹'));
            }
            for (let i = 0; i < 40; i++) {
                this.emojiPool.release(initialItems[i]);
            }
        }
    }

    get activeEmojis() {
        return this.emojiPool.active;
    }

    setEmojiTint(tintColor) {
        this.emojiTint = tintColor || null;
    }

    applyTheme(theme) {
        this.setEmojiTint(theme ? theme.emojiTint : null);

        if (this.activeBackground && this.activeBackground.group) {
            this.activeBackground.group.visible = false;
        }

        if (theme && typeof theme.createBackground === 'function') {
            let bg = this.backgroundCache.get(theme.name);
            if (!bg) {
                bg = theme.createBackground({
                    scene: this.scene,
                    camera: this.camera,
                });
                if (bg && bg.group) {
                    this.scene.add(bg.group);
                }
                this.backgroundCache.set(theme.name, bg);
            }
            if (bg && bg.group) {
                bg.group.visible = true;
            }
            this.activeBackground = bg;
        } else {
            this.activeBackground = null;
        }
    }

    updateGraphBounds(center, radius = 250) {
        if (
            this.activeBackground &&
            typeof this.activeBackground.onGraphBoundsChange === 'function'
        ) {
            this.activeBackground.onGraphBoundsChange(center, radius);
        }
    }

    update(
        delta,
        frequencyData = null,
        graphCenter = null,
        graphRadius = null,
    ) {
        this._updateEmojis(delta);

        if (
            this.activeBackground &&
            typeof this.activeBackground.update === 'function'
        ) {
            this.activeBackground.update(
                delta,
                frequencyData,
                graphCenter,
                graphRadius,
            );
        }
    }

    _updateEmojis(delta) {
        this._cameraUp
            .set(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();

        const lifeStep = delta * 1.25;
        const moveStep = delta * 30;

        for (let i = this.emojiPool.active.length - 1; i >= 0; i--) {
            const emojiData = this.emojiPool.active[i];
            emojiData.life -= lifeStep;

            if (emojiData.life <= 0) {
                this.emojiPool.releaseIndex(i);
                continue;
            }

            emojiData.sprite.position.addScaledVector(this._cameraUp, moveStep);
            emojiData.sprite.material.opacity = emojiData.life;
        }
    }

    showInstrumentEmoji(position, emoji) {
        const item = this.emojiPool.acquire(emoji);
        item.sprite.position.copy(position);
        this.scene.add(item.sprite);
    }

    _getEmojiTexture(emoji, tintColor = null) {
        const cacheKey = tintColor ? `${emoji}_${tintColor}` : emoji;
        let texture = this.emojiTextureCache.get(cacheKey);

        if (!texture) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (tintColor) {
                ctx.filter = 'grayscale(100%) contrast(120%)';
                ctx.fillText(emoji, 32, 32);

                ctx.filter = 'none';
                ctx.globalCompositeOperation = 'color';
                ctx.fillStyle = tintColor;
                ctx.fillRect(0, 0, 64, 64);

                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillText(emoji, 32, 32);
            } else {
                ctx.fillText(emoji, 32, 32);
            }

            texture = new THREE.CanvasTexture(canvas);
            this.emojiTextureCache.set(cacheKey, texture);
        }
        return texture;
    }

    _createEmojiSprite(emoji) {
        const texture = this._getEmojiTexture(emoji, this.emojiTint);

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            color: 0xffffff,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(40, 40, 1);
        return { sprite: sprite, life: 1.0 };
    }

    clear() {
        this.emojiPool.clear((item) => {
            this.scene.remove(item.sprite);
            if (item.sprite.material) item.sprite.material.dispose();
        });
    }

    dispose() {
        this.clear();
        for (const bg of this.backgroundCache.values()) {
            if (bg && bg.group) {
                this.scene.remove(bg.group);
            }
            if (bg && typeof bg.dispose === 'function') {
                bg.dispose();
            }
        }
        this.backgroundCache.clear();
        this.activeBackground = null;
    }
}
