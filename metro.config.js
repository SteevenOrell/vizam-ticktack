// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web loads a WebAssembly build of SQLite. We only use its async API, which does not need
// SharedArrayBuffer, so no COOP/COEP headers are required (verified in phase 2, see docs/AGENT_HANDOFF.md).
config.resolver.assetExts.push('wasm');

// Node-only modules must never be bundled into the app.
config.resolver.blockList = [/src[\\/]data[\\/]db[\\/]betterSqliteDriver\.ts$/];

module.exports = config;
