// Push the theme to its R2 bucket.
//
//   npm run push              build the CSS, then upload the whole theme
//   npm run push -- --dry-run list what would be uploaded, upload nothing
//   npm run push -- --no-build   upload without rebuilding first
//   npm run push -- --only hero  upload only paths containing "hero"
//
// Everything is uploaded every time rather than diffed against the bucket.
// Wrangler has no HEAD for objects, so "what changed?" would mean downloading
// each one first — as many round trips as just writing them. A local hash
// cache would be faster but goes stale the moment anyone else pushes, and a
// theme that silently skips a file is worse than one that takes 15 seconds.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const BUCKET = process.env.THEME_BUCKET ?? 'cms-themes';
const PREFIX = (process.env.THEME_PREFIX ?? 't/85b4297c328c3117/www-theme').replace(/^\/+|\/+$/g, '');

// The directories the Worker reads. assets-source/, tools/ and the npm files
// are build inputs and must not reach the bucket.
const TREES = ['assets', 'layout', 'sections', 'snippets', 'templates'];

// Hash of everything above, written after a successful full push. colorholic-www
// reads it into its page cache key, so a theme push invalidates rendered HTML —
// without it the key only moves when the Worker redeploys or a page is
// republished, and edits sit behind the CDN for up to ~11 minutes.
const VERSION_OBJECT = 'theme-version';

const CONTENT_TYPES = {
  '.css': 'text/css',
  '.json': 'application/json',
  '.liquid': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const CONCURRENCY = 6;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noBuild = args.includes('--no-build');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function collect() {
  const files = [];
  for (const tree of TREES) files.push(...(await walk(join(root, tree))));
  const rel = files.map((file) => relative(root, file).split(/[\\/]/).join('/')).sort();
  return only ? rel.filter((file) => file.includes(only)) : rel;
}

async function upload(path) {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  await run('npx', [
    'wrangler', 'r2', 'object', 'put', `${BUCKET}/${PREFIX}/${path}`,
    '--file', join(root, path),
    '--content-type', contentType,
    '--remote',
  ], { cwd: root });
}

async function pool(items, worker) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        try {
          await worker(next);
          process.stdout.write(`  ✓ ${next}\n`);
        } catch (error) {
          failures.push({ path: next, error });
          process.stdout.write(`  ✗ ${next}\n`);
        }
      }
    }),
  );
  return failures;
}

const files = await collect();
if (files.length === 0) {
  console.error(only ? `No theme files match --only ${only}` : 'No theme files found.');
  process.exit(1);
}

console.log(`${dryRun ? 'Would push' : 'Pushing'} ${files.length} file(s) to ${BUCKET}/${PREFIX}\n`);

if (dryRun) {
  for (const file of files) console.log(`  · ${file}`);
  process.exit(0);
}

// Build before uploading. assets/site.css is a build artifact, so pushing
// without this ships whatever the last build left behind — the edit appears to
// work and silently reverts next time someone runs the build.
if (!noBuild) {
  if (only && !files.some((file) => file.endsWith('.css'))) {
    console.log('Skipping build: --only selected no stylesheet.\n');
  } else {
    console.log('Building CSS…');
    await run('npm', ['run', 'build:css'], { cwd: root });
  }
}

const failures = await pool(files, upload);

// The version marker goes last, and only if every file landed. The Worker
// folds it into its page cache key, so publishing a new version while some
// file failed to upload would advertise a theme state that is not in the
// bucket — and cache the half-pushed render under it.
if (failures.length === 0 && !only) {
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path);
    digest.update('\0');
    digest.update(await readFile(join(root, path)));
    digest.update('\n');
  }
  const version = digest.digest('hex').slice(0, 16);
  const scratch = join(tmpdir(), `theme-version-${process.pid}`);
  await writeFile(scratch, version);
  try {
    await run('npx', [
      'wrangler', 'r2', 'object', 'put', `${BUCKET}/${PREFIX}/${VERSION_OBJECT}`,
      '--file', scratch, '--content-type', 'text/plain', '--remote',
    ], { cwd: root });
    console.log(`  ✓ ${VERSION_OBJECT} (${version})`);
  } finally {
    await unlink(scratch).catch(() => {});
  }
} else if (only && failures.length === 0) {
  console.log(`\n  ! ${VERSION_OBJECT} not updated: --only pushes a subset, so the`);
  console.log('    hash would not describe the bucket. Run a full push to bump it,');
  console.log('    or expect the page cache to keep serving the previous render.');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} file(s) failed:`);
  for (const { path, error } of failures) {
    console.error(`  ${path}: ${String(error.stderr || error.message).trim().split('\n').pop()}`);
  }
  process.exit(1);
}

console.log(`\nPushed ${files.length} file(s).`);
console.log('Warm Worker isolates cache templates for their lifetime, so the change');
console.log('may take a little while to appear on every request.');
