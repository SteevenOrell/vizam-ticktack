// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web loads a WebAssembly build of SQLite.
config.resolver.assetExts.push('wasm');

// Node-only modules must never be bundled into the app.
config.resolver.blockList = [/src[\\/]data[\\/]db[\\/]betterSqliteDriver\.ts$/];

// Cross-origin isolation for the dev server (SharedArrayBuffer for expo-sqlite on web).
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
