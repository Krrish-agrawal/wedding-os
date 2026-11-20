import { rm } from 'node:fs/promises';
import { VAR_DIR } from '../config.js';

/** Clears all runtime state (lead database, outbox) so a demo run starts clean. Content in /data is untouched. */
await rm(VAR_DIR, { recursive: true, force: true });
console.log(`Cleared ${VAR_DIR}`);
