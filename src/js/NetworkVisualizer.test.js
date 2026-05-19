import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { NetworkLayout } from './NetworkLayout.js';
import { Utils } from './Utils.js';

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
        ((this.update = vi.fn()),
            (this.showInstrumentEmoji = vi.fn()),
            (this.clear = vi.fn()));
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
    let mockElement;

    const createMockNodeData = (id, instanceId = 0) => {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        mesh.userData = {
            type: 'node',
            id,
            origEmissive: 0,
            origEmissiveIntensity: 0.2,
        };
        return {
            mesh,
            playCount: 0,
            instanceId,
            baseColor: new THREE.Color(),
            degree: 1,
        };
    };

    const createMockEdgeData = (sourceId, targetId, instanceId = 0) => {
        const line = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial(),
        );
        line.userData = {
            type: 'edge',
            sourceId,
            targetId,
            weight: 1,
            origMaterial: line.material,
        };
        const cone = {
            userData: { origMaterial: new THREE.MeshBasicMaterial() },
            material: new THREE.MeshBasicMaterial(),
            position: new THREE.Vector3(),
            instanceId,
        };
        return {
            line,
            cone,
            playCount: 0,
            sourceId,
            targetId,
            seed: Math.random(),
        };
    };

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
        };

        mockElement = {
            appendChild: vi.fn(),
            getContext: vi.fn(() => ({
                fillText: vi.fn(),
                measureText: vi.fn(() => ({ width: 10 })),
            })),
            style: {},
            width: 0,
            height: 0,
        };

        const rafm = vi.fn();
        vi.stubGlobal('requestAnimationFrame', rafm);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        vi.stubGlobal('document', {
            getElementById: vi.fn(() => mockContainer),
            createElement: vi.fn(() => mockElement),
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            visibilityState: 'visible',
        });

        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            devicePixelRatio: 1,
            requestAnimationFrame: rafm,
            cancelAnimationFrame: vi.fn(),
        });

        vi.stubGlobal('performance', {
            now: vi.fn(() => Date.now()),
        });

        visualizer = new NetworkVisualizer('visualizer-container');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    describe('Initialization & Cleanup', () => {
        it('should initialize with correct components following AAA pattern', () => {
            expect(visualizer.scene).toBeDefined();
            expect(visualizer.camera).toBeDefined();
            expect(visualizer.renderer).toBeDefined();
        });

        it('should set up event listeners on initialization', () => {
            expect(window.addEventListener).toHaveBeenCalledWith(
                'resize',
                expect.any(Function),
            );
            expect(mockContainer.addEventListener).toHaveBeenCalledWith(
                'pointermove',
                expect.any(Function),
            );
        });

        it('should clear state on clear()', () => {
            visualizer._initSharedGeometries();
            visualizer.nodes.set('test', createMockNodeData('test'));
            visualizer.clear();
            expect(visualizer.nodes.size).toBe(0);
            expect(visualizer.effects.clear).toHaveBeenCalled();
        });

        it('should dispose resources and remove listeners on dispose()', () => {
            const spy = vi.spyOn(visualizer.renderer, 'dispose');
            visualizer.dispose();
            expect(spy).toHaveBeenCalled();
            expect(window.removeEventListener).toHaveBeenCalled();
        });

        it('should update paused state', () => {
            visualizer.setPaused(true);
            expect(visualizer.isPaused).toBe(true);
            visualizer.setPaused(false);
            expect(visualizer.isPaused).toBe(false);
        });
    });

    describe('Building Visualization', () => {
        it('should build visualization from a graph and initialize layout', async () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4' }],
            );
            await visualizer.buildVisualization(mockGraph);
            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
        });

        it('should calculate max metrics and report progress', async () => {
            const mockGraph = createMockGraph([
                { id: 'A', data: { degree: 10 } },
            ]);
            const progressSpy = vi.fn();
            visualizer.onLayoutProgress = progressSpy;
            await visualizer.buildVisualization(mockGraph);
            expect(visualizer.maxDegree).toBe(10);
            expect(progressSpy).toHaveBeenCalledWith(100);
        });

        it('should handle disconnected components by linking to hub', async () => {
            const mockGraph = createMockGraph(
                [
                    { id: 'Hub', data: { degree: 1 } },
                    { id: 'Iso', data: { degree: 1 } },
                ],
                [],
            );
            await visualizer.buildVisualization(mockGraph);
            expect(mockGraph.addLink).toHaveBeenCalled();
        });

        it('should handle empty graph in fitCameraToGraph', () => {
            visualizer.nodes.clear();
            expect(() => visualizer.fitCameraToGraph()).not.toThrow();
        });
    });

    describe('Incremental Updates', () => {
        it('should initialize incremental mode and start auto-tour', () => {
            visualizer.initIncremental(createMockGraph());
            expect(visualizer.incrementalMode).toBe(true);
            expect(visualizer.autoTour).toBe(true);
        });

        it('should handle adding transitions incrementally and schedule scale updates', () => {
            vi.useFakeTimers();
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 50 } },
                { id: 'G4', data: { degree: 50 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.maxDegree = 1;

            visualizer.addTransitionIncremental('C4', 'G4');
            expect(visualizer._globalUpdateTimeout).toBeDefined();
            vi.runOnlyPendingTimers();
            expect(visualizer._globalUpdateTimeout).toBeNull();
            vi.useRealTimers();
        });
    });

    describe('Interaction & Highlighting', () => {
        it('should delegate showInstrumentEmoji to EffectsManager', () => {
            visualizer.nodes.set('C4', createMockNodeData('C4'));
            visualizer.showInstrumentEmoji('C4', '🎹');
            expect(visualizer.effects.showInstrumentEmoji).toHaveBeenCalled();
        });

        it('should highlight and release playing elements', () => {
            visualizer._initSharedGeometries();
            visualizer.graph = createMockGraph(
                [],
                [{ fromId: 'C4', toId: 'G4' }],
            );
            visualizer.layout = new NetworkLayout(visualizer.graph);
            visualizer.nodes.set('C4', createMockNodeData('C4', 0));
            visualizer.nodes.set('G4', createMockNodeData('G4', 1));
            visualizer.edgeMap.set('C4->G4', createMockEdgeData('C4', 'G4', 0));
            visualizer.edgeBufferIndexMap.set('C4->G4', 0);

            visualizer.highlightPlayingElement('G4', 'C4');
            expect(visualizer.playingNodes.size).toBe(1);

            visualizer.releasePlayingElement('G4', 'C4');
            expect(visualizer.playingNodes.size).toBe(0);
        });

        it('should reset all playing highlights', () => {
            visualizer._initSharedGeometries();
            visualizer.graph = createMockGraph(
                [],
                [{ fromId: 'C4', toId: 'G4' }],
            );
            visualizer.layout = new NetworkLayout(visualizer.graph);
            visualizer.nodes.set('C4', createMockNodeData('C4', 0));
            visualizer.edgeMap.set('C4->G4', createMockEdgeData('C4', 'G4', 0));
            visualizer.edgeBufferIndexMap.set('C4->G4', 0);
            visualizer.playingNodes.add(visualizer.nodes.get('C4'));

            visualizer.resetPlayingHighlights();
            expect(visualizer.playingNodes.size).toBe(0);
        });
    });

    describe('Raycasting & Hover', () => {
        it('should handle raycasting for nodes', () => {
            visualizer._initSharedGeometries();
            const nodeId = 'C4';
            const nodeData = createMockNodeData(nodeId);
            visualizer.nodes.set(nodeId, nodeData);
            visualizer.instanceIdNodeMap.set(0, nodeId);
            visualizer.graph = createMockGraph([{ id: nodeId }]);

            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: visualizer.nodeInstancedMesh, instanceId: 0 },
            ]);
            visualizer.mouseMoved = true;
            const hoverSpy = vi.fn();
            visualizer.onHover = hoverSpy;

            visualizer._performRaycast();
            expect(visualizer.hoveredObject).toBe(nodeData.mesh);
            expect(hoverSpy).toHaveBeenCalled();
        });

        it('should handle raycasting for edges', () => {
            visualizer._initSharedGeometries();
            const fromId = 'C4',
                toId = 'G4';
            const edgeId = `${fromId}->${toId}`;
            const edgeData = createMockEdgeData(fromId, toId);
            visualizer.edgeMap.set(edgeId, edgeData);
            visualizer.instanceIdEdgeMap.set(0, edgeId);
            visualizer.graph = createMockGraph([], [{ fromId, toId }]);
            visualizer.layout = new NetworkLayout(visualizer.graph);

            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: visualizer.edgeLineSegments, index: 0 },
            ]);
            visualizer.mouseMoved = true;
            visualizer._performRaycast();
            expect(visualizer.hoveredObject).toBe(edgeData.line);
        });

        it('should clear hover state when nothing hit', () => {
            visualizer._initSharedGeometries();
            visualizer.hoveredObject = {
                userData: { type: 'node', id: 'A' },
                material: { emissive: new THREE.Color() },
            };
            visualizer.nodes.set('A', createMockNodeData('A'));
            visualizer.raycaster.intersectObjects = vi.fn(() => []);
            visualizer.mouseMoved = true;
            visualizer._performRaycast();
            expect(visualizer.hoveredObject).toBeNull();
        });
    });

    describe('Animation Loop & Tour', () => {
        it('should skip updates when hidden', () => {
            document.visibilityState = 'hidden';
            visualizer._isAnimating = true;
            const stepSpy = vi.spyOn(visualizer, '_stepIncrementalPhysics');
            visualizer.animate(1000);
            expect(stepSpy).not.toHaveBeenCalled();
        });

        it('should step physics and update positions when active', () => {
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer._isAnimating = true;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('A', createMockNodeData('A'));
            visualizer.animate(1000);
            expect(visualizer.layout.step).toHaveBeenCalled();
        });

        it('should throttle physics on mobile', () => {
            vi.spyOn(Utils, 'isMobile').mockReturnValue(true);
            visualizer = new NetworkVisualizer('c');
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('A', createMockNodeData('A'));
            visualizer._isAnimating = true;

            visualizer._frameCount = 0;
            visualizer.animate(1000); // f1
            expect(visualizer.layout.step).not.toHaveBeenCalled();
            visualizer.animate(1100); // f2
            expect(visualizer.layout.step).toHaveBeenCalled();
        });

        it('should transition camera position during auto-tour', () => {
            visualizer._initSharedGeometries();
            visualizer.graphRadius = 100;
            visualizer.graphCenter = new THREE.Vector3(0, 0, 0);
            visualizer.startAutoTour();
            visualizer.nodes.set('A', createMockNodeData('A'));
            visualizer.camera.position.set(0, 0, 0);
            const initialPos = visualizer.camera.position.clone();
            visualizer._isAnimating = true;
            visualizer._lastFrameTime = 1000;
            visualizer.animate(2000);
            expect(
                visualizer.camera.position.distanceTo(initialPos),
            ).toBeGreaterThan(0);
        });

        it('should handle window resize', () => {
            const spy = vi.spyOn(visualizer.renderer, 'setSize');
            const resizeListener = window.addEventListener.mock.calls.find(
                (c) => c[0] === 'resize',
            )[1];
            resizeListener();
            expect(spy).toHaveBeenCalled();
        });
    });
});
