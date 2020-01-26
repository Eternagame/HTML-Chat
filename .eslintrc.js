module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: [
    'plugin:vue/essential',
    '@vue/airbnb',
    '@vue/typescript',
  ],
  ignorePatterns: ['vue.config.js', 'server/'],
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    camelcase: 'off',
    'vue/script-indent': ['error', 2, {
      baseIndent: 1,
    }],
    'no-param-reassign': ['error', { props: false }],
    semi: 'off',
    '@typescript-eslint/semi': ['error'],
    'no-unused-vars': 'off',
    'arrow-parens': 'off',
    'no-underscore-dangle': ['error', { allow: ['__INITIAL_STATE__'] }],
    'no-plusplus': 'off',
    'max-classes-per-file': 'off',
    'class-methods-use-this': 'off',
    'no-unused-expressions': 'off',
  },
  parserOptions: {
    parser: '@typescript-eslint/parser',
  },
  overrides: [
    {
      files: ['*.vue'],
      rules: {
        indent: 'off',
      },
    },
    {
      files: [
        '**/__tests__/*.{j,t}s?(x)',
      ],
      env: {
        jest: true,
      },
    },
  ],
};
