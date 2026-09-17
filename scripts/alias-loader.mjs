/**
 * Resolves the `@/*` path alias for `node --experimental-strip-types`, so the
 * verification suite can import the same modules the bundler does instead of
 * a second copy with rewritten paths.
 */
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolvePath(import.meta.dirname, '..', 'src');

/** Bundler-style extension resolution: the source imports carry no extension. */
function withExtension(path) {
  if (existsSync(path)) return path;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(path + ext)) return path + ext;
  }
  return path;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = withExtension(resolvePath(root, specifier.slice(2)));
    return nextResolve(pathToFileURL(target).href, context);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = context.parentURL?.startsWith('file:')
      ? resolvePath(new URL('.', context.parentURL).pathname, specifier)
      : null;
    if (base && !existsSync(base)) {
      const target = withExtension(base);
      if (target !== base) return nextResolve(pathToFileURL(target).href, context);
    }
  }
  return nextResolve(specifier, context);
}
