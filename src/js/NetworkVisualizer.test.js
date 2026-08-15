import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { Utils } from './Utils.js';
import {
    DefaultTheme,
    TerminatorTheme,
    ConstellationTheme,
    TakeOnMeRealTheme,
} from './Themes.js';

// --- Mocks ---

vi.mock('./NetworkLayout.js', () => ({
    NetworkLayout: vi.fn().mockImplementation(function () {
        this.layout = {
            step: vi.fn(),
            getNodePosition: vi.fn(() => ({ x: 1, y: 1, z: 1 })),
            dispose: vi.fn(),
        };
        this.runSimulation = vi.fn((steps, progressCb) => {
            if (progressCb) progressCb(100);
            return Promise.resolve(true);
        });
        this.step = () => this.layout.step();
        this.getNodePosition = (id) => this.layout.getNodePosition(id);
        this.dispose = () => this.layout.dispose();
    }),
}));

vi.mock('./VisualEffectsManager.js', () => ({
    VisualEffectsManager: vi.fn().mockImplementation(function () {
        this.activeEmojis = [];
        this.update = vi.fn();
        this.showInstrumentEmoji = vi.fn();
        this.enableTerminatorBackground = vi.fn();
        this.enableConstellationBackground = vi.fn();
        this.enableStudioBackground = vi.fn();
        this.clear = vi.fn();
        this.setRetroMode = vi.fn();
        this.setConstellationMode = vi.fn();
    }),
}));

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGLRenderer: vi.fn().mockImplementation(function () {
            return {
                setSize: vi.fn(),
                setPixelRatio: vi.fn(),
                setClearColor: vi.fn(),
                setRenderTarget: vi.fn(),
                render: vi.fn(),
                domElement: {
                    appendChild: vi.fn(),
                    getBoundingClientRect: vi.fn(() => ({
                        left: 0,
                        top: 0,
                        width: 1000,
                        height: 1000,
                    })),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    parentElement: {
                        removeChild: vi.fn(),
                    },
                    style: {},
                },
                dispose: vi.fn(),
            };
        }),
    };
});

vi.mock('three/examples/jsm/controls/TrackballControls.js', () => ({
    TrackballControls: vi.fn().mockImplementation(function () {
        return {
            rotateSpeed: 1,
            dynamicDampingFactor: 0.1,
            update: vi.fn(),
            reset: vi.fn(),
            dispose: vi.fn(),
            target: new THREE.Vector3(),
            addEventListener: vi.fn(),
        };
    }),
}));

vi.mock('postprocessing', () => ({
    EffectComposer: vi.fn().mockImplementation(function (renderer, options) {
        const type =
            (options && options.frameBufferType) || THREE.UnsignedByteType;
        const buffer = {
            texture: {
                type: type,
            },
        };
        return {
            addPass: vi.fn(),
            removePass: vi.fn(),
            setSize: vi.fn(),
            render: vi.fn(),
            dispose: vi.fn(),
            inputBuffer: buffer,
            writeBuffer: buffer,
        };
    }),
    RenderPass: vi.fn(),
    EffectPass: vi.fn(),
    BloomEffect: vi.fn().mockImplementation(function (options) {
        return {
            intensity: options ? options.intensity : 3.0,
            luminanceMaterial: {
                threshold: options ? options.luminanceThreshold : 0.15,
            },
        };
    }),
    Effect: class {
        constructor() {
            this.uniforms = new Map();
        }
    },
}));

describe('NetworkVisualizer', () => {
    let visualizer;
    let mockContainer;

    const createMockGraph = (nodes = [], links = []) => {
        const sanitizedLinks = links.map((l) => ({
            ...l,
            fromId: l.fromId || 'A',
            toId: l.toId || 'B',
            data: l.data || { weight: 1 },
        }));

        return {
            forEachNode: vi.fn((cb) => {
                nodes.forEach((node) => cb(node));
            }),
            forEachLinkedNode: vi.fn((id, cb) => {
                sanitizedLinks.forEach((link) => {
                    if (link.fromId === id) cb({ id: link.toId });
                    if (link.toId === id) cb({ id: link.fromId });
                });
            }),
            forEachLink: vi.fn((cb) => {
                sanitizedLinks.forEach((link) => cb(link));
            }),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNodesCount: vi.fn(() => nodes.length),
            getNode: vi.fn(
                (id) =>
                    nodes.find((n) => n.id === id) || {
                        id,
                        data: { degree: 1 },
                    },
            ),
            getLink: vi.fn((from, to) =>
                sanitizedLinks.find((l) => l.fromId === from && l.toId === to),
            ),
        };
    };

    beforeEach(() => {
        mockContainer = {
            appendChild: vi.fn(),
            clientWidth: 1000,
            clientHeight: 1000,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            getBoundingClientRect: vi.fn(() => ({
                left: 0,
                top: 0,
                width: 1000,
                height: 1000,
            })),
            contains: vi.fn(() => true),
        };

        const rafm = vi.fn();
        vi.stubGlobal('requestAnimationFrame', rafm);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        vi.stubGlobal('document', {
            getElementById: vi.fn(() => mockContainer),
            createElement: vi.fn(() => ({
                appendChild: vi.fn(),
                getContext: vi.fn(() => ({})),
                style: {},
            })),
            documentElement: {
                setAttribute: vi.fn(),
                getAttribute: vi.fn(),
                style: {},
            },
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            visibilityState: 'visible',
            activeElement: { tagName: 'BODY' },
        });

        // Use Object.assign to keep some standard window properties if needed,
        // but here we just need a better stub that includes dispatchEvent
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            devicePixelRatio: 1,
            innerWidth: 1000,
            innerHeight: 1000,
            requestAnimationFrame: rafm,
            cancelAnimationFrame: vi.fn(),
            CustomEvent: class {},
            Event: class {},
        });

        vi.stubGlobal('performance', {
            now: vi.fn(() => Date.now()),
        });

        if (typeof Event === 'undefined') {
            vi.stubGlobal(
                'Event',
                class {
                    constructor(type) {
                        this.type = type;
                    }
                },
            );
        }

        visualizer = new NetworkVisualizer('visualizer-container');
        visualizer.themeManager.registerTheme(DefaultTheme);
        visualizer.themeManager.registerTheme(TerminatorTheme);
        visualizer.setTheme('default');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    describe('Lifecycle & Resource Management', () => {
        it('initializes and attaches to container', () => {
            expect(visualizer.scene).toBeDefined();
            expect(visualizer.camera).toBeDefined();
            expect(mockContainer.appendChild).toHaveBeenCalled();
        });

        it('disposes resources and removes DOM elements', () => {
            const rendererDisposeSpy = vi.spyOn(visualizer.renderer, 'dispose');
            visualizer.layout = { dispose: vi.fn() };
            const domElement = visualizer.renderer.domElement;
            const removeChildSpy = domElement.parentElement.removeChild;

            visualizer.dispose();

            expect(rendererDisposeSpy).toHaveBeenCalled();
            expect(removeChildSpy).toHaveBeenCalledWith(domElement);
            expect(window.removeEventListener).toHaveBeenCalledWith(
                'resize',
                expect.any(Function),
            );
        });

        it('clears state without throwing', () => {
            expect(() => visualizer.clear()).not.toThrow();
            expect(visualizer.nodes.size).toBe(0);
            expect(visualizer.effects.clear).toHaveBeenCalled();
        });

        it('supports pausing and unpausing', () => {
            visualizer.setPaused(true);
            expect(visualizer.isPaused).toBe(true);
            visualizer.setPaused(false);
            expect(visualizer.isPaused).toBe(false);
        });
    });

    describe('Graph Visualization', () => {
        it('builds visualization from a graph', async () => {
            const mockGraph = createMockGraph(
                [{ id: 'C4', data: { degree: 1 } }],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );

            await visualizer.buildVisualization(mockGraph);

            expect(visualizer.graph).toBe(mockGraph);
            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
        });

        it('fits camera to graph bounds', async () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [],
            );
            // Mock positions to create a known radius
            visualizer.layout = {
                getNodePosition: vi.fn((id) =>
                    id === 'C4' ? { x: 0, y: 0, z: 0 } : { x: 10, y: 0, z: 0 },
                ),
                runSimulation: vi.fn(() => Promise.resolve()),
                dispose: vi.fn(),
            };

            await visualizer.buildVisualization(mockGraph);
            visualizer.fitCameraToGraph();

            expect(visualizer.graphCenter.x).toBeGreaterThan(0);
            expect(visualizer.graphRadius).toBeGreaterThan(0);
            expect(visualizer.controls.target.x).toBeCloseTo(
                visualizer.graphCenter.x,
            );
        });

        it('handles incremental transition updates', () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.initIncremental(mockGraph);

            visualizer.addTransitionIncremental('C4', 'G4');

            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.nodes.has('G4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
        });

        it('links isolated components to the main hub', async () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'Hub', data: { degree: 5 } },
                    { id: 'Isolated', data: { degree: 1 } },
                ],
                [],
            );

            await visualizer.buildVisualization(mockGraph);

            // Verified via private logic but triggered by public API
            expect(mockGraph.addLink).toHaveBeenCalledWith(
                'Hub',
                'Isolated',
                expect.objectContaining({ isFake: true }),
            );
        });
    });

    describe('Themes & Visuals', () => {
        it('switches themes and updates visual properties', () => {
            const themeA = {
                name: 'themeA',
                highlightColor: 0xff0000,
                onActivate: vi.fn(),
                onDeactivate: vi.fn(),
            };
            const themeB = {
                name: 'themeB',
                highlightColor: 0x00ff00,
                onActivate: vi.fn(),
                onDeactivate: vi.fn(),
            };
            visualizer.themeManager.registerTheme(themeA);
            visualizer.themeManager.registerTheme(themeB);

            visualizer.setTheme('themeA');
            visualizer.setTheme('themeB');

            expect(themeA.onDeactivate).toHaveBeenCalled();
            expect(themeB.onActivate).toHaveBeenCalled();
            expect(visualizer.highlightColor).toBe(0x00ff00);
        });

        it('cycles through available themes', () => {
            const initialTheme = visualizer.currentThemeName;
            const nextTheme = visualizer.cycleTheme();

            expect(nextTheme).not.toBe(initialTheme);
            expect(visualizer.currentThemeName).toBe(nextTheme);
        });

        it('enables and disables retro effects', () => {
            visualizer.enableRetroEffects(true);
            expect(visualizer.composer.addPass).toHaveBeenCalled();
            expect(visualizer.retroCRTPass).toBeDefined();

            visualizer.enableRetroEffects(false);
            expect(visualizer.composer.removePass).toHaveBeenCalled();
        });

        it('re-initializes geometries with different LOD', () => {
            const spy = vi.spyOn(visualizer, '_initSharedGeometries');
            visualizer._reinitGeometries(8);
            expect(spy).toHaveBeenCalledWith(8);
            expect(visualizer._currentGeometrySegments).toBe(8);
        });

        it('updates resolution based on theme constraints', () => {
            const rendererSpy = vi.spyOn(visualizer.renderer, 'setSize');
            const theme = {
                maxResolution: { width: 640, height: 480 },
            };
            visualizer.themeManager.registerTheme({
                name: 'res-test',
                ...theme,
            });
            visualizer.setTheme('res-test');

            expect(rendererSpy).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number),
                false,
            );
            expect(visualizer.renderer.domElement.style.imageRendering).toBe(
                'pixelated',
            );
        });

        it('manages high-precision HalfFloatType buffers only for the constellation theme', () => {
            const spyComposer = vi.mocked(EffectComposer);

            // Re-register the ConstellationTheme and transition to default first to set baseline
            visualizer.themeManager.registerTheme(ConstellationTheme);
            visualizer.setTheme('default');

            spyComposer.mockClear();

            // Set to constellation theme (should trigger recreation with HalfFloatType)
            visualizer.setTheme('constellation');
            expect(spyComposer).toHaveBeenCalledWith(
                visualizer.renderer,
                expect.objectContaining({
                    frameBufferType: THREE.HalfFloatType,
                }),
            );

            spyComposer.mockClear();

            // Set back to default theme (should trigger recreation with UnsignedByteType)
            visualizer.setTheme('default');
            expect(spyComposer).toHaveBeenCalledWith(
                visualizer.renderer,
                expect.objectContaining({
                    frameBufferType: THREE.UnsignedByteType,
                }),
            );
        });

        it('configures bloom intensity and luminance threshold based on the active theme to avoid white haze on light backgrounds', () => {
            visualizer.themeManager.registerTheme(TakeOnMeRealTheme);

            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);

            // Transition to default theme first
            visualizer.setTheme('default');
            expect(visualizer.bloomEffect.intensity).toBeCloseTo(3.0);
            expect(
                visualizer.bloomEffect.luminanceMaterial.threshold,
            ).toBeCloseTo(0.15);

            // Switch to take-on-me-real theme
            visualizer.setTheme('take-on-me-real');
            expect(visualizer.bloomEffect.intensity).toBeCloseTo(1.0);
            expect(
                visualizer.bloomEffect.luminanceMaterial.threshold,
            ).toBeCloseTo(0.9);
            expect(visualizer.edgeLineSegments.visible).toBe(false);
            expect(visualizer.edgeTubeInstancedMesh.visible).toBe(true);

            // Transition back to default theme first (should disable visibility)
            visualizer.setTheme('default');
            expect(visualizer.edgeLineSegments.visible).toBe(true);
            expect(visualizer.edgeTubeInstancedMesh.visible).toBe(false);
        });
    });

    describe('Playback Highlights', () => {
        it('manages node highlights with reference counting', () => {
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');

            visualizer.highlightPlayingElement('C4');
            visualizer.highlightPlayingElement('C4');
            const nodeData = visualizer.nodes.get('C4');

            expect(nodeData.playCount).toBe(2);
            expect(visualizer.playingNodes.has(nodeData)).toBe(true);

            visualizer.releasePlayingElement('C4');
            expect(nodeData.playCount).toBe(1);

            visualizer.releasePlayingElement('C4');
            expect(nodeData.playCount).toBe(0);
            expect(visualizer.playingNodes.has(nodeData)).toBe(false);
        });

        it('manages edge highlights with reference counting', () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental('C4', 'G4');

            visualizer.highlightPlayingElement('G4', 'C4');
            const edgeData = visualizer.edgeMap.get('C4->G4');

            expect(edgeData.playCount).toBe(1);
            expect(visualizer.playingEdges.has(edgeData)).toBe(true);

            visualizer.releasePlayingElement('G4', 'C4');
            expect(edgeData.playCount).toBe(0);
            expect(visualizer.playingEdges.has(edgeData)).toBe(false);
        });

        it('resets all active highlights and updates instance colors', () => {
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');
            visualizer.highlightPlayingElement('C4');

            const spy = vi.spyOn(visualizer.nodeInstancedMesh, 'setColorAt');

            visualizer.resetPlayingHighlights();

            expect(visualizer.playingNodes.size).toBe(0);
            expect(visualizer.nodes.get('C4').playCount).toBe(0);
            expect(spy).toHaveBeenCalled();
        });

        it('triggers instrument emojis through the effects manager', () => {
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');

            visualizer.showInstrumentEmoji('C4', '🎹');

            expect(visualizer.effects.showInstrumentEmoji).toHaveBeenCalled();
        });

        it('supports gold highlights in the constellation theme when elements are highlighted', () => {
            visualizer.themeManager.registerTheme(ConstellationTheme);
            visualizer.setTheme('constellation');

            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental('C4', 'G4');

            const spyNodeSetColor = vi.spyOn(
                visualizer.nodeInstancedMesh,
                'setColorAt',
            );

            visualizer.highlightPlayingElement('G4', 'C4');

            expect(spyNodeSetColor).toHaveBeenCalled();
            expect(visualizer.highlightColor).toBe(0xffd700);
        });

        it('uses subtle dark blue for inactive edges in constellation theme, and forceOriginalColor preserves highlights', () => {
            visualizer.themeManager.registerTheme(ConstellationTheme);

            // Set to default theme first
            visualizer.setTheme('default');
            const defaultEdgeColor = visualizer._getEdgeColor(0.5).clone();
            // Verify standard theme edge color is not blue
            expect(defaultEdgeColor.r).not.toBe(
                visualizer._constellationEdgeLow.r,
            );

            // Set to constellation theme
            visualizer.setTheme('constellation');
            const constellationEdgeColor = visualizer
                ._getEdgeColor(0.5)
                .clone();

            // Verify constellation theme edge color is the subtle dark blue
            const expectedBlue = visualizer._constellationEdgeLow
                .clone()
                .lerp(visualizer._constellationEdgeHigh, 0.5);
            expect(constellationEdgeColor.r).toBeCloseTo(expectedBlue.r);
            expect(constellationEdgeColor.g).toBeCloseTo(expectedBlue.g);
            expect(constellationEdgeColor.b).toBeCloseTo(expectedBlue.b);

            // Verify forceOriginalColor returns the original default colors
            const forcedColor = visualizer._getEdgeColor(0.5, true).clone();
            const expectedDefault = visualizer._colorLow
                .clone()
                .lerp(visualizer._colorMid, 1.0);
            expect(forcedColor.r).toBeCloseTo(expectedDefault.r);
            expect(forcedColor.g).toBeCloseTo(expectedDefault.g);
            expect(forcedColor.b).toBeCloseTo(expectedDefault.b);
        });

        it('uses soft pastel teal for inactive edges in take-on-me-real theme, and forceOriginalColor preserves highlights', () => {
            visualizer.themeManager.registerTheme(TakeOnMeRealTheme);

            // Set to default theme first
            visualizer.setTheme('default');
            const defaultEdgeColor = visualizer._getEdgeColor(0.5).clone();
            // Verify standard theme edge color is not pastel teal
            expect(defaultEdgeColor.r).not.toBe(visualizer._takeOnMeEdgeLow.r);

            // Set to take-on-me-real theme
            visualizer.setTheme('take-on-me-real');
            const takeOnMeEdgeColor = visualizer._getEdgeColor(0.5).clone();

            // Verify take-on-me-real theme edge color is the soft pastel teal
            const expectedTeal = visualizer._takeOnMeEdgeLow
                .clone()
                .lerp(visualizer._takeOnMeEdgeHigh, 0.5);
            expect(takeOnMeEdgeColor.r).toBeCloseTo(expectedTeal.r);
            expect(takeOnMeEdgeColor.g).toBeCloseTo(expectedTeal.g);
            expect(takeOnMeEdgeColor.b).toBeCloseTo(expectedTeal.b);

            // Verify forceOriginalColor returns the original default colors
            const forcedColor = visualizer._getEdgeColor(0.5, true).clone();
            const expectedDefault = visualizer._colorLow
                .clone()
                .lerp(visualizer._colorMid, 1.0);
            expect(forcedColor.r).toBeCloseTo(expectedDefault.r);
            expect(forcedColor.g).toBeCloseTo(expectedDefault.g);
            expect(forcedColor.b).toBeCloseTo(expectedDefault.b);
        });

        it('should update the colors of already-existing edges in the graph when switching themes to prevent side effects', () => {
            visualizer.themeManager.registerTheme(ConstellationTheme);
            visualizer.setTheme('default');

            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental('C4', 'G4');

            // Set to constellation theme (should update edge buffer colors to blue)
            visualizer.setTheme('constellation');
            const colorAttr =
                visualizer.edgeLineSegments.geometry.attributes.color;

            // Check that the buffer color is updated to the constellation blue
            const expectedBlue = visualizer._constellationEdgeLow
                .clone()
                .lerp(visualizer._constellationEdgeHigh, 1.0);
            expect(colorAttr.array[0]).toBeCloseTo(expectedBlue.r);
            expect(colorAttr.array[1]).toBeCloseTo(expectedBlue.g);
            expect(colorAttr.array[2]).toBeCloseTo(expectedBlue.b);

            // Set back to default theme (should reset edge colors and not leave side effects)
            visualizer.setTheme('default');
            const expectedDefaultColor = visualizer._colorMid
                .clone()
                .lerp(visualizer._colorHigh, 1.0);
            expect(colorAttr.array[0]).toBeCloseTo(expectedDefaultColor.r);
            expect(colorAttr.array[1]).toBeCloseTo(expectedDefaultColor.g);
            expect(colorAttr.array[2]).toBeCloseTo(expectedDefaultColor.b);
        });

        it('should update the colors of currently active highlighted nodes when switching themes to prevent side effects', () => {
            visualizer.themeManager.registerTheme(ConstellationTheme);
            visualizer.setTheme('default');

            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');

            const nodeData = visualizer.nodes.get('C4');
            const setColorCalls = [];
            visualizer.nodeInstancedMesh.setColorAt = (idx, color) => {
                setColorCalls.push(color.clone());
            };

            // Highlight the node under default theme
            visualizer.highlightPlayingElement('C4');

            // Expected default highlight color is highlightColor (0xffe600) * highlightIntensity (3.5)
            const defaultExpected = new THREE.Color(
                visualizer.highlightColor,
            ).multiplyScalar(visualizer.highlightIntensity);
            expect(setColorCalls[0].r).toBeCloseTo(defaultExpected.r);
            expect(setColorCalls[0].g).toBeCloseTo(defaultExpected.g);
            expect(setColorCalls[0].b).toBeCloseTo(defaultExpected.b);

            setColorCalls.length = 0;

            // Switch to constellation theme (should update currently highlighted node to base color * constellation boost)
            visualizer.setTheme('constellation');
            const constellationExpected = new THREE.Color(
                nodeData.baseColor,
            ).multiplyScalar(visualizer.highlightIntensity * 1.5);
            expect(setColorCalls[0].r).toBeCloseTo(constellationExpected.r);
            expect(setColorCalls[0].g).toBeCloseTo(constellationExpected.g);
            expect(setColorCalls[0].b).toBeCloseTo(constellationExpected.b);

            setColorCalls.length = 0;

            // Switch back to default theme (should update active node color back to default highlight color and intensity)
            visualizer.setTheme('default');
            expect(setColorCalls[0].r).toBeCloseTo(defaultExpected.r);
            expect(setColorCalls[0].g).toBeCloseTo(defaultExpected.g);
            expect(setColorCalls[0].b).toBeCloseTo(defaultExpected.b);
        });
    });

    describe('User Interaction & Event Handlers', () => {
        it('handles window resize by updating renderer and camera', () => {
            const rendererSpy = vi.spyOn(visualizer.renderer, 'setSize');
            const composerSpy = vi.spyOn(visualizer.composer, 'setSize');

            // The listener is bound to _onWindowResize, we can call it directly to test behavior
            visualizer._onWindowResize();

            expect(rendererSpy).toHaveBeenCalled();
            expect(composerSpy).toHaveBeenCalled();
        });

        it('stops auto-tour on control interaction', () => {
            const tourSpy = vi.fn();
            visualizer.onTourChange = tourSpy;
            visualizer.autoTour = true;

            // Get the 'start' listener registered on controls
            const startListener =
                visualizer.controls.addEventListener.mock.calls.find(
                    (call) => call[0] === 'start',
                )[1];

            // Trigger the listener
            startListener();

            expect(visualizer.autoTour).toBe(false);
            expect(tourSpy).toHaveBeenCalledWith(false);
        });

        it('handles auto-tour lifecycle and callbacks', () => {
            const tourSpy = vi.fn();
            visualizer.onTourChange = tourSpy;

            visualizer.startAutoTour();
            expect(visualizer.autoTour).toBe(true);
            expect(tourSpy).toHaveBeenCalledWith(true);

            // Trigger speed change logic
            visualizer.tourSpeedChangeTimer = 0;
            visualizer.graphCenter = new THREE.Vector3(0, 0, 0);
            visualizer._updateAutoTour(0.1);
            expect(visualizer.tourSpeedChangeTimer).toBeGreaterThan(0);

            visualizer.stopAutoTour();
            expect(visualizer.autoTour).toBe(false);
            expect(tourSpy).toHaveBeenCalledWith(false);
        });

        it('updates mouse position on pointer interaction', () => {
            const mockEvent = {
                clientX: 500,
                clientY: 500,
            };
            visualizer._onPointerInteraction(mockEvent);

            expect(visualizer.mouse.x).toBe(0);
            expect(visualizer.mouse.y).toBe(0);
            expect(visualizer.mouseMoved).toBe(true);

            visualizer._onPointerLeave();
            expect(visualizer.mouse.x).toBe(-1000);
            expect(visualizer.mouseMoved).toBe(true);
        });

        it('performs raycasting on mouse move and triggers hover callback', () => {
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');
            visualizer.mouseMoved = true;
            visualizer.onHover = vi.fn();

            // Mock raycaster results
            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: visualizer.nodeInstancedMesh, instanceId: 0 },
            ]);

            visualizer._performRaycast();

            expect(visualizer.onHover).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'C4' }),
            );
        });

        it('resolves raycast targets for cones and edges', () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental('C4', 'G4');

            // 1. Test Cone intersection
            const coneIntersect = [
                { object: visualizer.coneInstancedMesh, instanceId: 0 },
            ];
            visualizer.raycaster.intersectObjects = vi.fn(() => coneIntersect);
            visualizer._performRaycast();
            expect(visualizer.hoveredObject.userData.type).toBe('edge');
            expect(visualizer.hoveredObject.userData.sourceId).toBe('C4');

            // 2. Test Edge intersection
            const edgeIntersect = [
                { object: visualizer.edgeLineSegments, index: 0 },
            ];
            visualizer.raycaster.intersectObjects = vi.fn(() => edgeIntersect);
            visualizer._performRaycast();
            expect(visualizer.hoveredObject.userData.type).toBe('edge');
        });
    });

    describe('Performance & Constraints', () => {
        it('skips heavy updates when document is hidden', () => {
            vi.stubGlobal('document', { visibilityState: 'hidden' });
            const physicsSpy = vi.spyOn(visualizer, '_stepIncrementalPhysics');
            visualizer._isAnimating = true;

            visualizer.animate(1000);

            expect(physicsSpy).not.toHaveBeenCalled();
        });

        it('throttles physics on mobile devices', () => {
            vi.spyOn(Utils, 'isMobile').mockReturnValue(true);
            const mobileVisualizer = new NetworkVisualizer('container');
            mobileVisualizer.themeManager.registerTheme(DefaultTheme);
            mobileVisualizer.setTheme('default');

            const mockGraph = createMockGraph([
                { id: 'A', data: { degree: 1 } },
            ]);
            mobileVisualizer.initIncremental(mockGraph); // Properly initialize geometries and state
            mobileVisualizer.incrementalMode = true;
            mobileVisualizer._isAnimating = true;
            mobileVisualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };

            // Frame 1: skip (frameCount 1)
            mobileVisualizer.animate(1000);
            expect(mobileVisualizer.layout.step).not.toHaveBeenCalled();

            // Frame 2: step (frameCount 2)
            mobileVisualizer.animate(1016);
            expect(mobileVisualizer.layout.step).toHaveBeenCalled();
        });
    });
});
