import * as THREE from 'three';

/**
 * Manages visual feedback like highlights and floating emojis.
 * Separated from NetworkVisualizer to follow SRP.
 */
export class VisualEffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.activeEmojis = [];
        this.emojiPool = [];
        this.emojiTextureCache = new Map();
        this.maxEmojis = 100;

        this._cameraUp = new THREE.Vector3();
    }

    update(delta) {
        this._updateEmojis(delta);
    }

    _updateEmojis(delta) {
        this._cameraUp
            .set(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();

        const lifeStep = delta * 1.25;
        const moveStep = delta * 30;

        for (let i = this.activeEmojis.length - 1; i >= 0; i--) {
            const emojiData = this.activeEmojis[i];
            emojiData.life -= lifeStep;

            if (emojiData.life <= 0) {
                this._recycleEmoji(i);
                continue;
            }

            emojiData.sprite.position.addScaledVector(this._cameraUp, moveStep);
            emojiData.sprite.material.opacity = emojiData.life;
        }
    }

    _recycleEmoji(index) {
        const emojiData = this.activeEmojis[index];
        this.scene.remove(emojiData.sprite);
        this.emojiPool.push(emojiData.sprite);
        this.activeEmojis.splice(index, 1);
    }

    showInstrumentEmoji(position, emoji) {
        if (this.activeEmojis.length >= this.maxEmojis) {
            this._recycleEmoji(0);
        }

        let sprite;
        if (this.emojiPool.length > 0) {
            sprite = this.emojiPool.pop();
            sprite.material.map = this._getEmojiTexture(emoji);
            sprite.material.opacity = 1.0;
        } else {
            sprite = this._createEmojiSprite(emoji);
        }

        sprite.position.copy(position);

        this.scene.add(sprite);
        this.activeEmojis.push({
            sprite: sprite,
            life: 1.0,
        });
    }

    _getEmojiTexture(emoji) {
        let texture = this.emojiTextureCache.get(emoji);

        if (!texture) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, 32, 32);

            texture = new THREE.CanvasTexture(canvas);
            this.emojiTextureCache.set(emoji, texture);
        }
        return texture;
    }

    _createEmojiSprite(emoji) {
        const texture = this._getEmojiTexture(emoji);

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(40, 40, 1);
        return sprite;
    }

    clear() {
        this.activeEmojis.forEach((emojiData) => {
            this.scene.remove(emojiData.sprite);
            if (emojiData.sprite.material) emojiData.sprite.material.dispose();
        });
        this.activeEmojis = [];

        this.emojiPool.forEach((sprite) => {
            if (sprite.material) sprite.material.dispose();
        });
        this.emojiPool = [];
    }
}
