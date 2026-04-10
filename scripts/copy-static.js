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

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB Cloudflare Workers Sites limit

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stats = fs.statSync(srcPath);
    if (stats.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (stats.isFile()) {
      if (stats.size > MAX_FILE_SIZE) {
        console.warn(`Skipping ${srcPath.replace(ROOT + '/', '')} (${(stats.size / 1024 / 1024).toFixed(1)}MB > 25MB limit)`);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

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
    copyDir(src, dest);
  } else if (stats.isFile()) {
    if (stats.size > MAX_FILE_SIZE) {
      console.warn(`Skipping ${entryName} (${(stats.size / 1024 / 1024).toFixed(1)}MB > 25MB limit)`);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const entries = fs.readdirSync(ROOT);
  entries.forEach(copyEntry);
  console.log('Static assets copied to dist/');
}

main();
