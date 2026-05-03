// Copies static assets into the Next.js standalone bundle so it can run
// directly with `node .next/standalone/apps/web/server.js`.
//
// Why: Next.js' `output: 'standalone'` produces a self-contained server
// at apps/web/.next/standalone/apps/web/server.js, but it does NOT serve
// /_next/static/* itself. The expected production deployment is to either
//   (a) put a reverse proxy in front that serves /_next/static/ from the
//       original .next/static/ directory, OR
//   (b) copy .next/static/ + public/ into the standalone bundle so the
//       Node process at least has the files at the right paths.
//
// We do (b) here so that running just `node server.js` works out of the
// box for self-contained Docker images, while still allowing the
// nginx-front pattern (which is faster) when deployed that way.

import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const STANDALONE = path.join(APP_DIR, '.next/standalone');
const STANDALONE_APP = path.join(STANDALONE, 'apps/web');

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(STANDALONE))) {
    console.warn('[postbuild] .next/standalone not present, skipping');
    return;
  }
  await mkdir(STANDALONE_APP, { recursive: true });

  // .next/static -> .next/standalone/apps/web/.next/static
  const fromStatic = path.join(APP_DIR, '.next/static');
  const toStatic = path.join(STANDALONE_APP, '.next/static');
  if (await exists(fromStatic)) {
    await mkdir(path.dirname(toStatic), { recursive: true });
    await cp(fromStatic, toStatic, { recursive: true, force: true });
    console.log('[postbuild] copied .next/static');
  }

  // public/ -> .next/standalone/apps/web/public
  const fromPublic = path.join(APP_DIR, 'public');
  const toPublic = path.join(STANDALONE_APP, 'public');
  if (await exists(fromPublic)) {
    await cp(fromPublic, toPublic, { recursive: true, force: true });
    console.log('[postbuild] copied public/');
  }
}

main().catch((err) => {
  console.error('[postbuild] failed:', err);
  process.exit(1);
});
