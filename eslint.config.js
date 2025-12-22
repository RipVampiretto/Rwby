const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                // Node.js globals
                console: 'readonly',
                process: 'readonly',
                module: 'readonly',
                require: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                exports: 'readonly',
                Buffer: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                fetch: 'readonly',
                Promise: 'readonly',
                AbortController: 'readonly',
                URL: 'readonly',
                Date: 'readonly',
                // Jest globals
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-console': 'off',
            'prefer-const': 'warn',
            'no-var': 'error',
            'eqeqeq': ['warn', 'smart'],
            'curly': ['warn', 'multi-line'],
            'no-throw-literal': 'error',
            'no-return-await': 'warn',
            'require-await': 'warn',
            'no-async-promise-executor': 'error',
            'no-prototype-builtins': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }] // Added rule
        }
    },
    {
        ignores: [
            'node_modules/',
            'coverage/',
            'temp/',
            '*.min.js'
        ]
    }
];
