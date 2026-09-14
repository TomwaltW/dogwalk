/** jest 配置 —— 纯 Node 环境,不需要微信开发者工具,不需要云环境,不需要网络。 */
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // 云函数目录部署时会被塞进 _shared 副本与 node_modules,不参与测试发现
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/cloudfunctions/[^/]+/_shared/'],
  clearMocks: true,
  restoreMocks: true,
};
