import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (/node_modules\/(three|postprocessing)\//.test(id)) {
                            return 'vendor-three';
                        }
                        if (
                            /node_modules\/(@tonejs|spessasynth_lib)\//.test(id)
                        ) {
                            return 'vendor-audio';
                        }
                        return 'vendor-core';
                    }
                },
            },
        },
    },
});
