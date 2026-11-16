// Export file names: the picture the artist saves must always end in the right extension (".png" for a still), never be
// renamed by hand, never get a doubled extension, and never replace a file that was not explicitly confirmed.
const path = require('node:path');
const fsSync = require('node:fs');

/** ".png" from a suggested name or an explicit extension argument; '' when none is known. */
function wantedExtension(suggestedName, extension) {
  const raw = typeof extension === 'string' && extension ? extension : path.extname(suggestedName ?? '');
  const ext = raw.startsWith('.') ? raw : raw ? '.' + raw : '';
  return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : '';
}

/** Appends the extension when the chosen name lacks it (case-insensitive), so "bild" -> "bild.png" and "bild.PNG" stays. */
function ensureExtension(chosenPath, ext) {
  if (!ext) return chosenPath;
  return chosenPath.toLowerCase().endsWith(ext.toLowerCase()) ? chosenPath : chosenPath + ext;
}

/**
 * When the extension had to be added the operating system never asked about overwriting the final name, so an existing file
 * is kept and the new one gets "name (2).png". A name the dialog itself confirmed (extension already present) is untouched.
 */
function protectExisting(finalPath, wasConfirmed, exists = (p) => fsSync.existsSync(p)) {
  if (wasConfirmed || !exists(finalPath)) return finalPath;
  const ext = path.extname(finalPath), base = finalPath.slice(0, finalPath.length - ext.length);
  for (let n = 2; n < 1000; n++) { const candidate = `${base} (${n})${ext}`; if (!exists(candidate)) return candidate; }
  throw Error('Could not find a free file name');
}

function resolveSavePath(chosenPath, ext, exists) {
  const finalPath = ensureExtension(chosenPath, ext);
  return protectExisting(finalPath, finalPath === chosenPath, exists);
}

const dialogFilters = (ext) => (ext ? [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }, { name: 'All files', extensions: ['*'] }] : undefined);

module.exports = { wantedExtension, ensureExtension, protectExisting, resolveSavePath, dialogFilters };
