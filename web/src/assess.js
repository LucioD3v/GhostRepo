// Requirement 2: assess a repository BEFORE doing any work.
//
// Pure: works on the file listing only (paths and sizes), never on file
// contents. It uses the engine's own file-selection rule (src/files.js), so it
// cannot promise files the run will not read.

import { isEligibleJsPath, SKIP_DIRS } from '../../src/files.js';

// Documented limits (requirement 11.2). A run fetches every file of the scanned
// root except node_modules/ and .git/, so these bound what is downloaded.
export const LIMITS = Object.freeze({
  maxFiles: 2000,
  maxBytes: 25 * 1024 * 1024,
});

// Extension -> language, used only to tell the user what a repository looks
// like when it has nothing GhostRepo can modernize. Detected from file names.
const LANGUAGES = {
  '.py': 'Python',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.vb': 'Visual Basic',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.m': 'Objective-C',
  '.pl': 'Perl',
  '.lua': 'Lua',
  '.r': 'R',
  '.dart': 'Dart',
  '.ex': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.clj': 'Clojure',
  '.cob': 'COBOL',
  '.cbl': 'COBOL',
  '.f90': 'Fortran',
  '.pas': 'Pascal',
  '.sh': 'Shell',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.jsx': 'JSX',
  '.mjs': 'JavaScript modules (.mjs)',
  '.cjs': 'JavaScript CommonJS (.cjs)',
  '.coffee': 'CoffeeScript',
};

// Languages that look like JavaScript but are not processed by v1; worth naming.
const NEAR_JS = new Set(['TypeScript', 'JSX', 'JavaScript modules (.mjs)', 'JavaScript CommonJS (.cjs)', 'CoffeeScript']);

function extensionOf(path) {
  const name = path.split('/').pop();
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

/** True when the path lives inside node_modules/ or .git/ (never fetched). */
export function isInSkippedDir(posixPath) {
  const dirs = posixPath.split('/').filter(Boolean).slice(0, -1);
  return dirs.some((d) => SKIP_DIRS.has(d));
}

/**
 * @param {object} input
 * @param {Array<{path:string,size:number}>} input.entries  files (blobs) relative to the scanned root
 * @param {boolean} [input.truncated]  true when GitHub returned a partial listing
 * @param {object} [input.limits]
 */
export function assessListing({ entries, truncated = false, limits = LIMITS }) {
  const fetchable = entries.filter((e) => !isInSkippedDir(e.path));
  const eligible = entries.filter((e) => isEligibleJsPath(e.path)).map((e) => e.path).sort();

  const excluded = { minified: 0, vendored: 0 };
  for (const e of entries) {
    if (!e.path.endsWith('.js')) continue;
    if (isInSkippedDir(e.path)) excluded.vendored += 1;
    else if (e.path.endsWith('.min.js')) excluded.minified += 1;
  }

  const totalFiles = fetchable.length;
  const totalBytes = fetchable.reduce((sum, e) => sum + (e.size || 0), 0);

  // Languages by file count (known source languages + the engine's JavaScript).
  const counts = new Map();
  if (eligible.length > 0) counts.set('JavaScript', eligible.length);
  for (const e of fetchable) {
    const lang = LANGUAGES[extensionOf(e.path)];
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  const languages = [...counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const entryPoint = entries.some((e) => e.path === 'index.html') ? 'index.html' : null;
  const tooLarge = truncated || totalFiles > limits.maxFiles || totalBytes > limits.maxBytes;

  const base = {
    eligible,
    excluded,
    languages,
    entryPoint,
    totalFiles,
    totalBytes,
    limits,
    partial: truncated,
    suggestions: [],
    detected: null,
  };

  if (tooLarge) {
    return {
      ...base,
      verdict: 'TOO_LARGE',
      headline: 'Too large to analyze as a whole',
      details: tooLargeDetails({ truncated, totalFiles, totalBytes, limits }),
      suggestions: suggestFolders(eligible),
    };
  }

  if (eligible.length === 0) {
    const detected = detectLanguage(languages);
    return {
      ...base,
      verdict: 'NOT_SUPPORTED',
      headline: 'Not supported by this version',
      details: notSupportedDetails(detected, excluded),
      detected,
    };
  }

  const others = languages.filter((l) => l.name !== 'JavaScript' && !NEAR_JS.has(l.name));
  const details = [
    `${eligible.length} JavaScript file${eligible.length === 1 ? '' : 's'} will be analyzed.`,
  ];
  if (entryPoint) {
    details.push('A web entry point (index.html) was found: the live run will be available.');
  } else {
    details.push(
      'No index.html in the selected folder: the diff, the download and the pull request kit will be available, but not the live run.',
    );
    const nested = nestedEntryFolders(fetchable);
    if (nested.length > 0) {
      details.push(`An index.html exists in ${nested.join(', ')}. Select that folder to get the live run.`);
    }
  }
  if (others.length > 0) {
    details.push(
      `Files in other languages (${others.map((l) => `${l.name}: ${l.files}`).join(', ')}) will be left untouched.`,
    );
  }
  const nearJs = languages.filter((l) => NEAR_JS.has(l.name));
  if (nearJs.length > 0) {
    details.push(
      `${nearJs.map((l) => `${l.name} (${l.files})`).join(', ')} are not processed by this version.`,
    );
  }
  details.push(
    'This means the repository can be analyzed. The run may still end with no changes if nothing can be changed provably safely.',
  );

  return {
    ...base,
    verdict: entryPoint ? 'READY' : 'READY_NO_PREVIEW',
    headline: entryPoint ? 'Can be resurrected' : 'Can be resurrected, without live run',
    details,
  };
}

/** Folders (max 3) that contain an index.html, shallowest first. */
function nestedEntryFolders(entries) {
  return entries
    .filter((e) => e.path.endsWith('/index.html'))
    .map((e) => e.path.slice(0, -'/index.html'.length))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, 3);
}

function detectLanguage(languages) {
  const known = languages.filter((l) => l.name !== 'JavaScript');
  if (known.length === 0) return null;
  const total = known.reduce((s, l) => s + l.files, 0);
  const top = known[0];
  return { name: top.name, files: top.files, mostly: top.files / total >= 0.5 };
}

function notSupportedDetails(detected, excluded) {
  const details = ['GhostRepo v1 modernizes only JavaScript/web code.'];
  if (detected) {
    details.push(
      `This repository looks ${detected.mostly ? 'mostly like' : 'to include'} ${detected.name}: ` +
        `${detected.files} file${detected.files === 1 ? '' : 's'} with ${detected.name} extensions ` +
        '(detected from file extensions), and 0 eligible .js files.',
    );
  } else {
    details.push('No eligible .js files were found.');
  }
  const skipped = [];
  if (excluded.minified > 0) skipped.push(`${excluded.minified} minified (.min.js)`);
  if (excluded.vendored > 0) skipped.push(`${excluded.vendored} inside node_modules/ or .git/`);
  if (skipped.length > 0) details.push(`.js files that are excluded on purpose: ${skipped.join(', ')}.`);
  return details;
}

function tooLargeDetails({ truncated, totalFiles, totalBytes, limits }) {
  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  const details = [];
  if (truncated) {
    details.push('GitHub returned only a partial file listing for this repository, so it cannot be assessed as a whole.');
  } else {
    details.push(
      `It has ${totalFiles} files (${mb(totalBytes)} MB); the limit is ${limits.maxFiles} files and ${mb(limits.maxBytes)} MB.`,
    );
  }
  details.push('Select a subfolder to analyze only that part of the repository.');
  return details;
}

/** Folders (first path segment) holding the most eligible .js files. */
export function suggestFolders(eligible, max = 5) {
  const counts = new Map();
  for (const p of eligible) {
    const segs = p.split('/');
    if (segs.length < 2) continue;
    counts.set(segs[0], (counts.get(segs[0]) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, jsFiles]) => ({ folder, jsFiles }))
    .sort((a, b) => b.jsFiles - a.jsFiles || a.folder.localeCompare(b.folder))
    .slice(0, max);
}
