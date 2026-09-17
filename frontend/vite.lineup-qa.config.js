import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'./',build:{outDir:'qa-dist',rollupOptions:{input:'test-fixtures/lineup-picker.html'}}});
