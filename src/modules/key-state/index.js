/**
 * key-state  —  Zero-overhead Win32 key-state queries via N-API.
 *
 * Usage:
 *   const { isCtrlPressed } = require('./modules/key-state');
 *   if (isCtrlPressed()) { … }
 */

const bindings = require('bindings');
const addon = bindings('key_state');

module.exports = {
  isCtrlPressed: addon.isCtrlPressed,
  isKeyPressed:  addon.isKeyPressed,
};
