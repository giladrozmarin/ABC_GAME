const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = {
  ...config,
  resolver: {
    ...config.resolver,
    blacklistRE: /node_modules\/.*\/node_modules\/react-native\/.*/,
    // Block additional problematic paths
    blockList: [
      /node_modules\/.*\/node_modules\/react-native\/.*/,
      /.*\/Pods\/.*/,
      /.*\/\.git\/.*/,
      /.*\/\.DS_Store$/,
      /.*\/\.expo\/.*/,
      /.*\/\.expo-shared\/.*/,
      /.*\/web-build\/.*/,
      /.*\/android\/.*/,
      /.*\/ios\/.*/,
    ]
  },
  watchFolders: [],
  // Reduce file watching overhead
  maxWorkers: 1,
  resetCache: true,
  transformer: {
    ...config.transformer,
    minifierConfig: {
      ...config.transformer.minifierConfig,
      // Reduce memory usage
      keep_fnames: false,
    }
  },
  server: {
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        // Reduce server overhead
        res.setHeader('Cache-Control', 'no-cache');
        return middleware(req, res, next);
      };
    },
  },
}; 