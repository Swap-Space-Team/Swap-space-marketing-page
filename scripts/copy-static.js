const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const EXCLUDES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cursor',
  '.DS_Store',
  'scripts',
  'vercel.json',
  'setup-localhost.sh'
]);

function copyEntry(entryName) {
  if (EXCLUDES.has(entryName)) {
    return;
  }

  const src = path.join(ROOT, entryName);
  const dest = path.join(DIST, entryName);

  if (!fs.existsSync(src)) {
    return;
  }

  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  } else if (stats.isFile()) {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const entries = fs.readdirSync(ROOT);
  entries.forEach(copyEntry);
  console.log('Static assets copied to dist/');
}

main();

