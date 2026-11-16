import {defineConfig} from 'vitest/config';
// Incident backups can contain third-party browser extensions with *.test.js.
// Only project-owned tests may execute in our regression process.
export default defineConfig({test:{include:['tests/**/*.test.{ts,tsx,js,mjs,cjs}']}});
