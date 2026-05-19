import createLayout from 'ngraph.forcelayout';

/**
 * Manages the force-directed layout simulation for the network.
 * Separated from the visualizer to follow SRP.
 */
export class NetworkLayout {
    constructor(graph, options = {}) {
        this.graph = graph;
        this.layout = createLayout(graph, {
            dimensions: 3,
            physicsSettings: {
                springLength: 40,
                springCoefficient: 0.02,
                gravity: -200,
                theta: 0.8,
                dragCoefficient: 0.6,
                nodeMass: (nodeId) => {
                    const node = graph.getNode(nodeId);
                    if (!node) return 1;
                    const degree = (node.data && node.data.degree) || 1;
                    return 1 + Math.log2(degree + 1) * 5;
                },
                springTransform: (link, spring) => {
                    if (link.data && link.data.isFake) {
                        spring.length = 0;
                        spring.weight = 5;
                    } else {
                        spring.length = 40;
                        spring.weight = (link.data && link.data.weight) || 1;
                    }
                },
                ...options.physicsSettings,
            },
        });
    }

    step() {
        return this.layout.step();
    }

    getNodePosition(nodeId) {
        return this.layout.getNodePosition(nodeId);
    }

    setNodePosition(nodeId, x, y, z) {
        return this.layout.setNodePosition(nodeId, x, y, z);
    }

    dispose() {
        if (this.layout && this.layout.dispose) {
            this.layout.dispose();
        }
    }

    /**
     * Runs the layout simulation for a set number of steps.
     * @param {number} totalSteps
     * @param {Function} onProgress
     */
    async runSimulation(totalSteps = 3000, onProgress = null) {
        const batchSize = 100;

        for (let i = 0; i < totalSteps; i++) {
            this.layout.step();

            if (i % batchSize === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (onProgress) {
                    onProgress(Math.round((i / totalSteps) * 100));
                }
            }
        }
        if (onProgress) onProgress(100);
    }
}
