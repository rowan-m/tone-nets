import * as THREE from 'three';
import { Effect } from 'postprocessing';
import { AudioSpectrumAnalyzer } from '../AudioSpectrumAnalyzer.js';

const charcoalSketchFragmentShader = `
uniform float uTime;
uniform float uPaneAngle;
uniform vec2 uPaneCenter;
uniform vec2 uPaneSize;
uniform float uPaneYaw;
uniform float uPanePitch;
uniform float uPaneWidth;
uniform float uFPS;
uniform float uJitterStrength;
uniform vec2 uResolution;

float hash2D(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash2D(i + vec2(0.0, 0.0)), hash2D(i + vec2(1.0, 0.0)), u.x),
        mix(hash2D(i + vec2(0.0, 1.0)), hash2D(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float aspect = uResolution.x / uResolution.y;
    vec2 aspectUv = vec2(uv.x * aspect, uv.y);
    vec2 aspectCenter = vec2(uPaneCenter.x * aspect, uPaneCenter.y);
    vec2 centeredUv = aspectUv - aspectCenter;

    float x_rot = centeredUv.x * cos(uPaneYaw);
    float y_rot = centeredUv.y * cos(uPanePitch) - centeredUv.x * sin(uPaneYaw) * sin(uPanePitch);
    float z_rot = centeredUv.y * sin(uPanePitch) + centeredUv.x * sin(uPaneYaw) * cos(uPanePitch);

    float focalDistance = 1.8;
    float w = 1.0 - z_rot / focalDistance;
    vec2 projected = vec2(x_rot, y_rot) / w;

    float cosTheta = cos(uPaneAngle);
    float sinTheta = sin(uPaneAngle);
    vec2 dUv = vec2(
        projected.x * cosTheta + projected.y * sinTheta,
        -projected.x * sinTheta + projected.y * cosTheta
    );

    vec2 d = abs(dUv) - uPaneSize * 0.5;
    float outsideDist = length(max(d, 0.0));
    float insideDist = min(max(d.x, d.y), 0.0);
    float sdf = outsideDist + insideDist;

    bool isInside = (sdf <= 0.0);
    bool isBorder = (abs(sdf) <= uPaneWidth);

    if (!isInside && !isBorder) {
        outputColor = inputColor;
        return;
    }

    float sketchTime = floor(uTime * uFPS) / uFPS;
    
    float n1 = noise2D(uv * 45.0 + sketchTime * 8.0);
    float n2 = noise2D(uv * 45.0 - sketchTime * 11.0);
    vec2 jitter = vec2(n1 - 0.5, n2 - 0.5) * uJitterStrength;
    vec2 jitterUv = uv + jitter;

    vec4 texColor = texture2D(inputBuffer, jitterUv);
    float gray = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

    float texelX = 1.0 / uResolution.x;
    float texelY = 1.0 / uResolution.y;

    float g00 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g10 = dot(texture2D(inputBuffer, jitterUv + vec2(0.0, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g20 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g01 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float g21 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float g02 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g12 = dot(texture2D(inputBuffer, jitterUv + vec2(0.0, texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g22 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, texelY)).rgb, vec3(0.299, 0.587, 0.114));

    float sx = (g20 + 2.0 * g21 + g22) - (g00 + 2.0 * g01 + g02);
    float sy = (g02 + 2.0 * g12 + g22) - (g00 + 2.0 * g10 + g20);
    float edge = sqrt(sx * sx + sy * sy);

    float mask1 = noise2D(jitterUv * 130.0 + sketchTime * 5.0);
    float mask2 = noise2D(jitterUv * 260.0 - sketchTime * 8.5);
    float strokeMask = smoothstep(0.3, 0.7, (mask1 + mask2 * 0.5) / 1.5);
    
    float edgeStroke = smoothstep(0.08, 0.45, edge) * strokeMask;

    float paper = noise2D(uv * 400.0) * 0.12 + 0.88;
    
    float outlineColor = mix(gray, 0.22, edgeStroke * 0.75);

    float shadeNoise = noise2D(jitterUv * 200.0 + vec2(sketchTime, -sketchTime) * 2.0);
    float shadedGray = outlineColor;
    if (outlineColor < 0.8) {
        float shadeFactor = smoothstep(0.8, 0.2, outlineColor) * strokeMask;
        shadedGray = mix(outlineColor, outlineColor * (0.6 + 0.4 * shadeNoise), shadeFactor * 0.55);
    }

    float sketchColor = smoothstep(0.01, 0.99, shadedGray * paper);

    vec3 finalSketch = vec3(sketchColor);

    if (isBorder && !isInside) {
        float borderStroke = noise2D(uv * 300.0 + sketchTime * 5.0) * 0.4 + 0.6;
        float edgeOutline = smoothstep(uPaneWidth, uPaneWidth * 0.3, abs(sdf)) * borderStroke;
        finalSketch = mix(finalSketch, vec3(0.05), edgeOutline);
        outputColor = vec4(finalSketch, 1.0);
    } else {
        outputColor = vec4(finalSketch, 1.0);
    }
}
`;

export class CharcoalSketchEffect extends Effect {
    constructor() {
        super('CharcoalSketchEffect', charcoalSketchFragmentShader, {
            uniforms: new Map([
                ['uTime', new THREE.Uniform(0)],
                ['uPaneAngle', new THREE.Uniform(0)],
                ['uPaneCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
                ['uPaneSize', new THREE.Uniform(new THREE.Vector2(0.75, 0.55))],
                ['uPaneYaw', new THREE.Uniform(0)],
                ['uPanePitch', new THREE.Uniform(0)],
                ['uPaneWidth', new THREE.Uniform(0.015)],
                ['uFPS', new THREE.Uniform(5.0)],
                ['uJitterStrength', new THREE.Uniform(0.0035)],
                [
                    'uResolution',
                    new THREE.Uniform(new THREE.Vector2(1024, 768)),
                ],
            ]),
        });
        this.name = 'CharcoalSketchEffect';
        this._lastSketchFrame = -1;
    }

    update(renderer, inputBuffer, deltaTime) {
        const uTimeUniform = this.uniforms.get('uTime');
        uTimeUniform.value += deltaTime;
        const time = uTimeUniform.value;

        this.uniforms.get('uPaneAngle').value = time * 0.25;

        const center = this.uniforms.get('uPaneCenter').value;
        center.x = 0.5 + 0.42 * Math.sin(time * 0.22);
        center.y = 0.5 + 0.05 * Math.cos(time * 0.12);

        const size = this.uniforms.get('uPaneSize').value;
        size.x = 0.75 + 0.08 * Math.sin(time * 0.3);
        size.y = 0.55 + 0.05 * Math.cos(time * 0.5);

        this.uniforms.get('uPaneYaw').value = 0.45 * Math.sin(time * 0.4);
        this.uniforms.get('uPanePitch').value = 0.3 * Math.cos(time * 0.6);

        const res = this.uniforms.get('uResolution').value;
        if (inputBuffer) {
            res.set(inputBuffer.width, inputBuffer.height);
        }
    }

    updateAudio(frequencyData) {
        const uTime = this.uniforms.get('uTime').value;
        const fps = this.uniforms.get('uFPS').value;
        const currentFrame = Math.floor(uTime * fps);

        if (currentFrame !== this._lastSketchFrame) {
            this._lastSketchFrame = currentFrame;
            const bassEnergy = AudioSpectrumAnalyzer.getBandEnergy(
                frequencyData,
                0,
                0.2,
            );
            const targetJitter = 0.0028 + bassEnergy * 0.0055;
            this.uniforms.get('uJitterStrength').value = targetJitter;
        }
    }
}
