import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { ignores: ['.next/**', 'node_modules/**', 'src/generated/**'] },
  {
    // `mobile/` est une application Vite, pas Next : `next/image` n'y existe
    // pas, et son composant `<Image>` ne s'y compilerait même pas. La règle
    // qui le réclame n'a donc rien à y dire.
    files: ['mobile/**/*.{ts,tsx}'],
    rules: { '@next/next/no-img-element': 'off' },
  },
];
