import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { NetworkLayout } from './NetworkLayout.js';
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
            id,
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
            contains: vi.fn(() => true),
        };

        mockElement = {
            appendChild: vi.fn(),
            getContext: vi.fn(() => ({
                fillText: vi.fn(),
                measureText: vi.fn(() => ({ width: 10 })),
                fillRect: vi.fn(),
                createLinearGradient: vi.fn(() => ({
                    addColorStop: vi.fn(),
                })),
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
            activeElement: { tagName: 'BODY' },
            dispatchEvent: vi.fn(),
        });

        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            devicePixelRatio: 1,
            innerWidth: 1000,
            innerHeight: 1000,
            requestAnimationFrame: rafm,
            cancelAnimationFrame: vi.fn(),
        });

        vi.stubGlobal('performance', {
            now: vi.fn(() => Date.now()),
        });

        // Mock MouseEvent if not in environment
        if (typeof MouseEvent === 'undefined') {
            vi.stubGlobal(
                'MouseEvent',
                vi.fn().mockImplementation(function (type) {
                    this.type = type;
                }),
            );
        }
        if (typeof Event === 'undefined') {
            vi.stubGlobal(
                'Event',
                vi.fn().mockImplementation(function (type) {
                    this.type = type;
                }),
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

    describe('Lifecycle Management', () => {
        it('should correctly initialize and attach to the container', () => {
            // Assert initialization properties and container attachment
            expect(visualizer.scene).toBeDefined();
            expect(visualizer.camera).toBeDefined();
            expect(visualizer.renderer).toBeDefined();
            expect(mockContainer.appendChild).toHaveBeenCalled();
        });

        it('should properly dispose of all resources and remove DOM elements', () => {
            // Arrange
            const rendererDisposeSpy = vi.spyOn(visualizer.renderer, 'dispose');
            visualizer.layout = { dispose: vi.fn() };
            const removeChildSpy =
                visualizer.renderer.domElement.parentElement.removeChild;

            // Act
            visualizer.dispose();

            // Assert
            expect(rendererDisposeSpy).toHaveBeenCalled();
            expect(removeChildSpy).toHaveBeenCalledWith(
                visualizer.renderer.domElement,
            );
            expect(window.removeEventListener).toHaveBeenCalledWith(
                'resize',
                visualizer._onWindowResize,
            );
            expect(mockContainer.removeEventListener).toHaveBeenCalledWith(
                'pointermove',
                visualizer._onPointerInteraction,
            );
            expect(document.removeEventListener).toHaveBeenCalledWith(
                'click',
                visualizer._onDocumentClick,
            );
        });

        it('should handle disposal gracefully when renderer is already missing', () => {
            // Arrange
            visualizer.renderer = null;

            // Act & Assert
            expect(() => visualizer.dispose()).not.toThrow();
        });

        it('should clear internal state and effects on clear()', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.nodes.set('test', createMockNodeData('test'));
            visualizer.edgeMap.set('A->B', createMockEdgeData('A', 'B'));

            // Act
            visualizer.clear();

            // Assert
            expect(visualizer.nodes.size).toBe(0);
            expect(visualizer.edgeMap.size).toBe(0);
            expect(visualizer.effects.clear).toHaveBeenCalled();
        });
    });

    describe('Visualization Building', () => {
        it('should build a complete visualization from a graph', async () => {
            // Arrange
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 2 } },
                    { id: 'G4', data: { degree: 2 } },
                ],
                [{ fromId: 'C4', toId: 'G4' }],
            );

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.nodes.has('G4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
            expect(visualizer.maxDegree).toBe(2);
        });

        it('should handle an empty graph gracefully during visualization building', async () => {
            // Arrange
            const emptyGraph = createMockGraph([], []);

            // Act & Assert
            await expect(
                visualizer.buildVisualization(emptyGraph),
            ).resolves.not.toThrow();
            expect(visualizer.nodes.size).toBe(0);
        });

        it('should link isolated components to the highest degree hub', async () => {
            // Arrange
            const mockGraph = createMockGraph(
                [
                    { id: 'Hub', data: { degree: 5 } },
                    { id: 'Isolated', data: { degree: 1 } },
                ],
                [],
            );

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(mockGraph.addLink).toHaveBeenCalledWith(
                'Hub',
                'Isolated',
                expect.objectContaining({ isFake: true }),
            );
        });
    });

    describe('Theme System', () => {
        it('should switch themes and trigger activation/deactivation hooks', () => {
            // Arrange
            const themeA = {
                name: 'themeA',
                highlightColor: 0xff0000,
                background: 0x000000,
                nodeMaterial: {
                    roughness: 0,
                    metalness: 0,
                    emissiveIntensity: 0,
                },
                onActivate: vi.fn(),
                onDeactivate: vi.fn(),
            };
            const themeB = {
                name: 'themeB',
                highlightColor: 0x00ff00,
                background: 0x111111,
                nodeMaterial: {
                    roughness: 1,
                    metalness: 1,
                    emissiveIntensity: 1,
                },
                onActivate: vi.fn(),
                onDeactivate: vi.fn(),
            };
            visualizer.themeManager.registerTheme(themeA);
            visualizer.themeManager.registerTheme(themeB);
            visualizer.setTheme('themeA');

            // Act
            visualizer.setTheme('themeB');

            // Assert
            expect(themeA.onDeactivate).toHaveBeenCalledWith(visualizer);
            expect(themeB.onActivate).toHaveBeenCalledWith(visualizer);
            expect(visualizer.currentThemeName).toBe('themeB');
            expect(visualizer.highlightColor).toBe(0x00ff00);
        });

        it('should update existing node colors when theme changes', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const nodeData = createMockNodeData('C4');
            visualizer.nodes.set('C4', nodeData);
            visualizer.nodeList = [nodeData];
            visualizer.graph = createMockGraph([
                { id: 'C4', data: { degree: 1 } },
            ]);
            visualizer.layout = new NetworkLayout(visualizer.graph);
            const spy = vi.spyOn(visualizer.nodeInstancedMesh, 'setColorAt');

            // Act
            visualizer.setTheme('terminator');

            // Assert
            expect(spy).toHaveBeenCalled();
        });

        it('should cycle through registered themes', () => {
            // Arrange
            const initialTheme = visualizer.currentThemeName;

            // Act
            const nextTheme = visualizer.cycleTheme();

            // Assert
            expect(nextTheme).not.toBe(initialTheme);
            expect(visualizer.currentThemeName).toBe(nextTheme);
        });
    });

    describe('Incremental Mode', () => {
        it('should initialize incremental mode and enable auto-tour', () => {
            // Arrange
            const mockGraph = createMockGraph();

            // Act
            visualizer.initIncremental(mockGraph);

            // Assert
            expect(visualizer.incrementalMode).toBe(true);
            expect(visualizer.autoTour).toBe(true);
        });

        it('should handle adding transitions incrementally and debounce scale updates', () => {
            // Arrange
            vi.useFakeTimers();
            const mockGraph = createMockGraph([
                { id: 'C4', data: { degree: 10 } }, // Degree > maxDegree(1)
                { id: 'G4', data: { degree: 1 } },
            ]);
            visualizer.initIncremental(mockGraph);
            visualizer.graph = mockGraph;
            const updateSpy = vi.spyOn(visualizer, '_updateAllVisualScales');

            // Act
            visualizer.addTransitionIncremental('C4', 'G4');

            // Assert
            expect(updateSpy).not.toHaveBeenCalled(); // Debounced
            vi.advanceTimersByTime(250);
            expect(updateSpy).toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('should skip incremental update if targetId is missing', () => {
            // Arrange
            visualizer.incrementalMode = true;
            visualizer.graph = createMockGraph();

            // Act & Assert
            expect(() =>
                visualizer.addTransitionIncremental('C4', null),
            ).not.toThrow();
        });
    });

    describe('Real-time Interaction', () => {
        it('should highlight and release nodes during playback using reference counting', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.nodes.set('C4', createMockNodeData('C4', 0));
            const nodeData = visualizer.nodes.get('C4');

            // Act: Highlight twice (simulating overlapping notes)
            visualizer.highlightPlayingElement('C4');
            visualizer.highlightPlayingElement('C4');

            // Assert
            expect(nodeData.playCount).toBe(2);
            expect(visualizer.playingNodes.has(nodeData)).toBe(true);

            // Act: Release once
            visualizer.releasePlayingElement('C4');
            expect(nodeData.playCount).toBe(1);
            expect(visualizer.playingNodes.has(nodeData)).toBe(true);

            // Act: Release again
            visualizer.releasePlayingElement('C4');
            expect(nodeData.playCount).toBe(0);
            expect(visualizer.playingNodes.has(nodeData)).toBe(false);
        });

        it('should handle releasePlayingElement without a previous node', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.nodes.set('C4', createMockNodeData('C4', 0));
            visualizer.highlightPlayingElement('C4');

            // Act & Assert
            expect(() => visualizer.releasePlayingElement('C4')).not.toThrow();
            expect(visualizer.nodes.get('C4').playCount).toBe(0);
        });

        it('should delegate emoji display to VisualEffectsManager', () => {
            // Arrange
            visualizer.nodes.set('C4', createMockNodeData('C4'));

            // Act
            visualizer.showInstrumentEmoji('C4', '🎹');

            // Assert
            expect(visualizer.effects.showInstrumentEmoji).toHaveBeenCalled();
        });

        it('should reset all playing highlights', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.nodes.set('C4', createMockNodeData('C4', 0));
            visualizer.highlightPlayingElement('C4');

            // Act
            visualizer.resetPlayingHighlights();

            // Assert
            expect(visualizer.playingNodes.size).toBe(0);
            expect(visualizer.nodes.get('C4').playCount).toBe(0);
        });
    });

    describe('Raycasting and Event Handlers', () => {
        it('should perform raycasting and trigger onHover when mouse moves', () => {
            // Arrange
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

            // Act
            visualizer._performRaycast();

            // Assert
            expect(visualizer.hoveredObject).toBe(nodeData.mesh);
            expect(hoverSpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: nodeId }),
            );
        });

        it('should handle window resize events', () => {
            // Arrange
            const spy = vi.spyOn(visualizer.renderer, 'setSize');

            // Act
            visualizer._onWindowResize();

            // Assert
            expect(spy).toHaveBeenCalled();
        });

        it('should stop auto-tour on user click and trigger callback', () => {
            // Arrange
            visualizer.autoTour = true;
            const tourSpy = vi.fn();
            visualizer.onTourChange = tourSpy;

            // Act
            visualizer._onDocumentClick();

            // Assert
            expect(visualizer.autoTour).toBe(false);
            expect(tourSpy).toHaveBeenCalledWith(false);
        });

        it('should not trigger onTourChange if tour is already stopped', () => {
            // Arrange
            visualizer.autoTour = false;
            const tourSpy = vi.fn();
            visualizer.onTourChange = tourSpy;

            // Act
            visualizer.stopAutoTour();

            // Assert
            expect(tourSpy).not.toHaveBeenCalled();
        });

        it('should update mouse coordinates on pointermove', () => {
            // Arrange
            const pointerEvent = {
                clientX: 500,
                clientY: 500,
            };

            // Act
            visualizer._onPointerInteraction(pointerEvent);

            // Assert
            expect(visualizer.mouse.x).not.toBe(-1000);
            expect(visualizer.mouseMoved).toBe(true);
        });
    });

    describe('Animation Loop', () => {
        it('should skip frames when the document is hidden', () => {
            // Arrange
            vi.stubGlobal('document', {
                ...document,
                visibilityState: 'hidden',
            });
            const stepSpy = vi.spyOn(visualizer, '_stepIncrementalPhysics');
            visualizer._isAnimating = true;

            // Act
            visualizer.animate(1000);

            // Assert
            expect(stepSpy).not.toHaveBeenCalled();
            vi.stubGlobal('document', {
                ...document,
                visibilityState: 'visible',
            });
        });

        it('should update tour and physics when animating', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer._isAnimating = true;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('A', createMockNodeData('A'));

            // Act
            visualizer.animate(1000);

            // Assert
            expect(visualizer.layout.step).toHaveBeenCalled();
        });

        it('should throttle physics calculations on mobile devices', () => {
            // Arrange
            vi.spyOn(Utils, 'isMobile').mockReturnValue(true);
            const mobileVisualizer = new NetworkVisualizer(
                'visualizer-container',
            );
            mobileVisualizer._initSharedGeometries();
            mobileVisualizer.incrementalMode = true;
            mobileVisualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            mobileVisualizer.graph = createMockGraph();
            mobileVisualizer.nodes.set('A', createMockNodeData('A'));
            mobileVisualizer._isAnimating = true;

            // Act & Assert: Should step every 2nd frame
            mobileVisualizer.animate(1000); // Frame 1
            expect(mobileVisualizer.layout.step).not.toHaveBeenCalled();

            mobileVisualizer.animate(1016); // Frame 2
            expect(mobileVisualizer.layout.step).toHaveBeenCalled();
        });
    });
});
