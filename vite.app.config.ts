import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: 'app',
    plugins: [react()],
    build: {
        outDir: '../dist/app',
        emptyOutDir: true,
    },
    server: {
        port: 3002,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
