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
                if (id === 'high-degree') return { id, data: { degree: 15 } };
                if (id === 'low-degree') return { id, data: { degree: 1 } };
                return null;
            }),
        };
        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize ngraph.forcelayout with 3 dimensions and specific physics settings', () => {
            // Act
            const layout = new NetworkLayout(mockGraph);

            // Assert
            expect(createLayout).toHaveBeenCalledWith(
                mockGraph,
                expect.objectContaining({
                    dimensions: 3,
                    physicsSettings: expect.objectContaining({
                        springLength: 40,
                        springCoefficient: 0.02,
                        gravity: -200,
                        theta: 0.8,
                        dragCoefficient: 0.6,
                        nodeMass: expect.any(Function),
                        springTransform: expect.any(Function),
                    }),
                }),
            );
            expect(layout).toBeDefined();
        });

        it('should allow overriding default options', () => {
            // Arrange
            const customOptions = {
                physicsSettings: {
                    springLength: 100,
                },
            };

            // Act
            const layout = new NetworkLayout(mockGraph, customOptions);

            // Assert
            expect(createLayout).toHaveBeenCalledWith(
                mockGraph,
                expect.objectContaining({
                    physicsSettings: expect.objectContaining({
                        springLength: 100, // Overridden
                        gravity: -200, // Default preserved
                    }),
                }),
            );
            expect(layout).toBeDefined();
        });
    });

    describe('Physics Settings: Node Mass', () => {
        it('should assign exponentially higher mass to nodes with higher degrees', () => {
            // Arrange
            const layout = new NetworkLayout(mockGraph);
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            const nodeMassFn = callArgs[1].physicsSettings.nodeMass;

            // Act
            const massHigh = nodeMassFn('high-degree'); // degree 15
            const massLow = nodeMassFn('low-degree'); // degree 1
            const massMissing = nodeMassFn('missing'); // undefined node

            // Assert
            expect(massHigh).toBeGreaterThan(massLow);
            expect(massLow).toBeGreaterThan(massMissing);
            expect(massMissing).toBe(1); // Default mass for unknown nodes
            expect(layout).toBeDefined();
        });
    });

    describe('Physics Settings: Spring Transform', () => {
        it('should transform springs correctly based on link data', () => {
            // Arrange
            const layout = new NetworkLayout(mockGraph);
            const callArgs = vi.mocked(createLayout).mock.calls[0];
            const springTransformFn =
                callArgs[1].physicsSettings.springTransform;

            const fakeLink = { data: { isFake: true } };
            const fakeSpring = { length: 10, weight: 1 };

            const realLink = { data: { weight: 10 } };
            const realSpring = { length: 10, weight: 1 };

            const defaultLink = { data: {} };
            const defaultSpring = { length: 10, weight: 1 };

            // Act & Assert for Fake Links (Isolated Components)
            springTransformFn(fakeLink, fakeSpring);
            expect(fakeSpring.length).toBe(0);
            expect(fakeSpring.weight).toBe(5);

            // Act & Assert for Real Links
            springTransformFn(realLink, realSpring);
            expect(realSpring.length).toBe(40);
            expect(realSpring.weight).toBe(10);

            // Act & Assert for Default Links
            springTransformFn(defaultLink, defaultSpring);
            expect(defaultSpring.length).toBe(40);
            expect(defaultSpring.weight).toBe(1);
            expect(layout).toBeDefined();
        });
    });

    describe('Layout Operations', () => {
        it('should delegate step, getNodePosition, setNodePosition, and dispose to ngraph.forcelayout', () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);

            // Act
            networkLayout.step();
            const pos = networkLayout.getNodePosition('n1');
            networkLayout.setNodePosition('n1', 10, 20, 30);
            networkLayout.dispose();

            // Assert
            expect(networkLayout.layout.step).toHaveBeenCalled();
            expect(networkLayout.layout.getNodePosition).toHaveBeenCalledWith(
                'n1',
            );
            expect(pos).toEqual({ x: 1, y: 2, z: 3 });
            expect(networkLayout.layout.setNodePosition).toHaveBeenCalledWith(
                'n1',
                10,
                20,
                30,
            );
            expect(networkLayout.layout.dispose).toHaveBeenCalled();
        });
    });

    describe('Simulation Runner', () => {
        it('should run simulation and report progress', async () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);
            const progressCallback = vi.fn();

            // Act
            // Run a small number of steps to avoid long test times
            await networkLayout.runSimulation(200, progressCallback);

            // Assert
            expect(networkLayout.layout.step).toHaveBeenCalledTimes(200);
            // batchSize is 100, so it reports at 0%, 50%, and finally 100%
            expect(progressCallback).toHaveBeenCalledWith(0);
            expect(progressCallback).toHaveBeenCalledWith(50);
            expect(progressCallback).toHaveBeenCalledWith(100);
        });

        it('should run simulation without error if no progress callback is provided', async () => {
            // Arrange
            const networkLayout = new NetworkLayout(mockGraph);

            // Act
            await networkLayout.runSimulation(100, null);

            // Assert
            expect(networkLayout.layout.step).toHaveBeenCalledTimes(100);
        });
    });
});
