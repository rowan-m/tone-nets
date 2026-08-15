import { describe, it, expect, vi, beforeEach } from 'vitest';
import createLayout from 'ngraph.forcelayout';
import { NetworkLayout } from './NetworkLayout.js';

// Mock ngraph.forcelayout
vi.mock('ngraph.forcelayout', () => {
    return {
        default: vi.fn().mockImplementation(() => {
            return {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
                setNodePosition: vi.fn(),
                dispose: vi.fn(),
                simulator: {
                    getBody: vi.fn(() => ({ mass: 1 })),
                    bodies: {
                        forEach: vi.fn(),
                    },
                },
            };
        }),
    };
});

describe('NetworkLayout', () => {
    let mockGraph;

    beforeEach(() => {
        // Arrange
        mockGraph = {
            getNode: vi.fn((id) => {
                if (id === 'hub-node') return { id, data: { degree: 15 } };
                if (id === 'leaf-node') return { id, data: { degree: 1 } };
                if (id === 'no-data-node') return { id };
                if (id === 'zero-degree-node')
                    return { id, data: { degree: 0 } };
                if (id === 'missing-degree-node') return { id, data: {} };
                return null;
            }),
        };
        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize the force-directed layout in 3D mode', () => {
            // Act
            const layout = new NetworkLayout(mockGraph);

            // Assert
            expect(layout).toBeDefined();
            expect(createLayout).toHaveBeenCalledWith(
                mockGraph,
                expect.objectContaining({
                    dimensions: 3,
                }),
            );
        });

        it('should apply specific physics settings for music network visualization', () => {
            // Act
            const layout = new NetworkLayout(mockGraph);

            // Assert
            expect(layout).toBeDefined();
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            const physics = callArgs[1].physicsSettings;

            expect(physics).toMatchObject({
                springLength: 40,
                springCoefficient: 0.02,
                gravity: -200,
                theta: 0.8,
                dragCoefficient: 0.6,
            });
        });

        it('should allow user-provided physics settings to override defaults', () => {
            // Arrange
            const customSettings = {
                physicsSettings: {
                    springLength: 100,
                    gravity: -500,
                },
            };

            // Act
            const layout = new NetworkLayout(mockGraph, customSettings);

            // Assert
            expect(layout).toBeDefined();
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            const physics = callArgs[1].physicsSettings;

            expect(physics.springLength).toBe(100);
            expect(physics.gravity).toBe(-500);
            expect(physics.theta).toBeCloseTo(0.8); // Default preserved
        });
    });

    describe('Node Mass Calculation', () => {
        let nodeMassFn;

        beforeEach(() => {
            const layout = new NetworkLayout(mockGraph);
            expect(layout).toBeDefined();
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            nodeMassFn = callArgs[1].physicsSettings.nodeMass;
        });

        it('should assign higher mass to hub nodes to dominate the spatial layout', () => {
            // Act
            const massHub = nodeMassFn('hub-node'); // degree 15
            const massLeaf = nodeMassFn('leaf-node'); // degree 1

            // Assert
            expect(massHub).toBeGreaterThan(massLeaf);
            expect(massLeaf).toBeGreaterThan(1);
        });

        it('should return a default mass of 1 for unknown or missing nodes', () => {
            // Act
            const massMissing = nodeMassFn('unknown');
            const massNoData = nodeMassFn('no-data-node');
            const massZeroDegree = nodeMassFn('zero-degree-node');
            const massMissingDegree = nodeMassFn('missing-degree-node');

            // Assert
            expect(massMissing).toBe(1);
            expect(massNoData).toBe(1);
            expect(massZeroDegree).toBe(1);
            expect(massMissingDegree).toBe(1);
        });
    });

    describe('Spring Transformation', () => {
        let springTransformFn;

        beforeEach(() => {
            const layout = new NetworkLayout(mockGraph);
            expect(layout).toBeDefined();
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            springTransformFn = callArgs[1].physicsSettings.springTransform;
        });

        it('should compress fake links to zero length and fixed weight to pull components together', () => {
            // Arrange
            const fakeLink = { data: { isFake: true } };
            const spring = { length: 40, weight: 1 };

            // Act
            springTransformFn(fakeLink, spring);

            // Assert
            const springLength = spring.length;
            expect(springLength).toBe(0);
            expect(spring.weight).toBe(5);
        });

        it('should apply edge weights to real links to reflect transition frequency', () => {
            // Arrange
            const realLink = { data: { weight: 10 } };
            const spring = { length: 0, weight: 1 };

            // Act
            springTransformFn(realLink, spring);

            // Assert
            const springLength = spring.length;
            expect(springLength).toBe(40);
            expect(spring.weight).toBe(10);
        });

        it('should use default values for links without data', () => {
            // Arrange
            const plainLink = {};
            const spring = { length: 0, weight: 0 };

            // Act
            springTransformFn(plainLink, spring);

            // Assert
            const springLength = spring.length;
            expect(springLength).toBe(40);
            expect(spring.weight).toBe(1);
        });
    });

    describe('Layout Proxy Methods', () => {
        it('should correctly delegate operations to the underlying layout engine', () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);

            // Act & Assert for step
            networkLayout.step();
            expect(networkLayout.layout.step).toHaveBeenCalled();

            // Act & Assert for position getters/setters
            const pos = networkLayout.getNodePosition('node-1');
            expect(pos).toEqual({ x: 1, y: 2, z: 3 });

            networkLayout.setNodePosition('node-1', 10, 20, 30);
            expect(networkLayout.layout.setNodePosition).toHaveBeenCalledWith(
                'node-1',
                10,
                20,
                30,
            );
        });

        it('should safely dispose of the layout engine if it exists', () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);

            // Act
            networkLayout.dispose();

            // Assert
            expect(networkLayout.layout.dispose).toHaveBeenCalled();
        });

        it('should handle dispose safely if the layout engine does not have a dispose method', () => {
            // Arrange
            vi.mocked(createLayout).mockReturnValueOnce({ step: vi.fn() });
            const networkLayout = new NetworkLayout(mockGraph);

            // Act & Assert (should not throw)
            expect(() => networkLayout.dispose()).not.toThrow();
        });
    });

    describe('Simulation Execution', () => {
        it('should execute the requested number of simulation steps', async () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);

            // Act
            await networkLayout.runSimulation(150, null);

            // Assert
            expect(networkLayout.layout.step).toHaveBeenCalledTimes(150);
        });

        it('should report incremental progress during long simulations', async () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);
            const onProgress = vi.fn();

            // Act
            // batchSize is 100, so 250 steps should report at 0, 100, 200, and final 100%
            await networkLayout.runSimulation(250, onProgress);

            // Assert
            expect(onProgress).toHaveBeenCalledWith(0);
            expect(onProgress).toHaveBeenCalledWith(40); // 100/250 = 40%
            expect(onProgress).toHaveBeenCalledWith(80); // 200/250 = 80%
            expect(onProgress).toHaveBeenCalledWith(100); // Final
        });

        it('should complete and report 100% even for very small simulations', async () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);
            const onProgress = vi.fn();

            // Act
            await networkLayout.runSimulation(10, onProgress);

            // Assert
            expect(onProgress).toHaveBeenCalledWith(0);
            expect(onProgress).toHaveBeenCalledWith(100);
        });
    });
});
