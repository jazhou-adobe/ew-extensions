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
      // Worker code runs in Node (App Builder / I/O Runtime), not the browser.
      files: [
        'shared/worker-template/**/*.{js,mjs}',
        'apps/*/worker/**/*.{js,mjs}',
        'apps/*/providers/*/worker/**/*.{js,mjs}',
      ],
      env: { node: true, browser: false },
      rules: {
        'import/no-extraneous-dependencies': 'off',
        // Each worker is its own App Builder package but deliberately imports the shared core by relative path.
        'import/no-relative-packages': 'off',
        'no-underscore-dangle': ['error', {
          allow: [
            '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body',
            '__OW_ACTIVATION_ID', '__OW_DEADLINE',
          ],
        }],
      },
    },
    {
      files: [
        'shared/worker-template/test/**/*.js',
        'shared/worker-template/test-live/**/*.js',
        'apps/*/worker/test/**/*.js',
        'apps/*/providers/*/worker/test/**/*.js',
        'apps/*/worker/test-live/**/*.js',
        'apps/*/providers/*/worker/test-live/**/*.js',
        'apps/multi-dam-picker/test/**/*.js',
        'apps/*/test/**/*-worker.*.js',
        'scripts/*.test.mjs',
      ],
      rules: {
        'no-await-in-loop': 'off',
        'no-unused-expressions': 'off',
        'max-len': 'off',
        'max-statements-per-line': 'off',
        'object-curly-newline': 'off',
        'object-property-newline': 'off',
        'default-param-last': 'off',
        'no-underscore-dangle': 'off',
        camelcase: 'off',
        'no-script-url': 'off',
        'no-bitwise': 'off',
        'operator-assignment': 'off',
      },
    },
    {
      files: ['**/test/e2e/**/*.js'],
      env: { node: true },
      rules: { 'import/no-extraneous-dependencies': 'off', 'import/no-relative-packages': 'off' },
    },
  ],
};
