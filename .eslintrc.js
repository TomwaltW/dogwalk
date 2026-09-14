/**
 * 三种运行环境共存于一个仓库:
 *   cloudfunctions/**  —— Node(wx-server-sdk)
 *   miniprogram/**     —— 小程序宿主(wx / Page / App / Component 全局)
 *   tests/**           —— jest
 */
module.exports = {
  root: true,
  env: { node: true, es2021: true },
  parserOptions: { ecmaVersion: 2021, sourceType: 'script' },
  extends: ['eslint:recommended'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'cloudfunctions/*/node_modules/',
    'cloudfunctions/*/_shared/',
  ],
  rules: {
    'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_$' }],
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      files: ['miniprogram/**/*.js'],
      globals: {
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
    {
      files: ['tests/**/*.js'],
      env: { jest: true, node: true },
    },
  ],
};
