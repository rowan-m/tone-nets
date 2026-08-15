import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (
                            id.includes('three') ||
                            id.includes('postprocessing')
                        ) {
                            return 'vendor-three';
                        }
                        if (id.includes('tone') || id.includes('@tonejs')) {
                            return 'vendor-tone';
                        }
                        return 'vendor-core';
                    }
                },
            },
        },
    },
});
