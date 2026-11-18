module.exports = {
  root: true,
  extends: '@adobe/helix',
  env: { browser: true, es2022: true },
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  rules: {
    'import/extensions': ['error', 'always'],
    'import/no-unresolved': ['error', { ignore: ['^https?://'] }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'max-len': ['warn', { code: 120 }],
    'no-console': 'off',
    'header/header': 'off',
    'no-underscore-dangle': ['error', { allow: ['__sdkStub', '__sdkCalls'] }],
  },
  overrides: [
    {
      files: ['**/test/unit/**/*.js', 'test/support/**/*.js'],
      env: { mocha: true },
      rules: { 'no-unused-expressions': 'off' },
    },
    {
      files: ['scripts/**/*.mjs', '*.cjs', '*.mjs'],
      env: { node: true, browser: false },
      rules: { 'import/no-extraneous-dependencies': 'off' },
    },
    {
      files: ['**/test/e2e/**/*.js'],
      env: { node: true },
      rules: { 'import/no-extraneous-dependencies': 'off' },
    },
  ],
};
