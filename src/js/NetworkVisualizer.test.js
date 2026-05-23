import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { Utils } from './Utils.js';
import { DefaultTheme, TerminatorTheme } from './Themes.js';

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
        this.clear = vi.fn();
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
            target: {
                copy: vi.fn(),
                set: vi.fn(),
                clone: vi.fn(() => new THREE.Vector3()),
            },
            addEventListener: vi.fn(),
        };
    }),
}));

vi.mock('postprocessing', () => ({
    EffectComposer: vi.fn().mockImplementation(function () {
        return {
            addPass: vi.fn(),
            setSize: vi.fn(),
            render: vi.fn(),
            dispose: vi.fn(),
        };
    }),
    RenderPass: vi.fn(),
    EffectPass: vi.fn(),
    BloomEffect: vi.fn(),
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

        it('resets all active highlights', () => {
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.addTransitionIncremental(null, 'C4');
            visualizer.highlightPlayingElement('C4');

            visualizer.resetPlayingHighlights();

            expect(visualizer.playingNodes.size).toBe(0);
            expect(visualizer.nodes.get('C4').playCount).toBe(0);
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

        it('stops auto-tour on user interaction', () => {
            visualizer.autoTour = true;
            const tourSpy = vi.fn();
            visualizer.onTourChange = tourSpy;

            visualizer._onDocumentClick();

            expect(visualizer.autoTour).toBe(false);
            expect(tourSpy).toHaveBeenCalledWith(false);
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
