import { getConsoleFunction, setConsoleFunction } from 'three';

/**
 * @react-three/fiber 9.8 still creates a THREE.Clock for its store, and three 0.186 warns once that
 * Clock is deprecated. The warning is about library internals we cannot change, so this drops that
 * one message and forwards every other three.js log, warning and error unchanged.
 */
const SILENCED = ['THREE.Clock: This module has been deprecated'];

const previous = getConsoleFunction();
setConsoleFunction((type, message, ...params) => {
  if (SILENCED.some((s) => message.startsWith(s))) return;
  if (previous) return previous(type, message, ...params);
  console[type](message, ...params);
});
