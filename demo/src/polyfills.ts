// The Midnight SDK packages (compact-runtime, midnight-js-utils, platform-js)
// call Node's `Buffer` global, which browsers don't have and Vite doesn't
// shim. Install it once, before any SDK module loads.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
