// Requirement 6: build ONE self-contained HTML document that runs a project in a
// sandboxed iframe (srcdoc), entirely from memory.
//
// Every stylesheet, script and image is inlined, so the frame never needs the
// network and never gets a URL to reach. Safety does not depend on this code:
// the caller must put the document in an iframe with sandbox="allow-scripts"
// (no allow-same-origin), so the project runs in an opaque origin with no access
// to the UI page, its storage or any credential. The CSP below also blocks the
// network. The project is untrusted data until the user presses "Run".

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

const CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; " +
  "frame-src 'none'; form-action 'none'; base-uri 'none'";

// Reports uncaught errors to the UI page (requirement 6.6). Plain data only.
const ERROR_REPORTER = `(function(){
  function send(message){ try { window.parent.postMessage({ ghostrepo: 'preview-error', message: String(message) }, '*'); } catch (e) {} }
  window.addEventListener('error', function(e){ send(e.message + (e.lineno ? ' (line ' + e.lineno + ')' : '')); });
  window.addEventListener('unhandledrejection', function(e){ send('Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason)); });
})();`;

export function mimeFor(path) {
  const i = path.lastIndexOf('.');
  return (i >= 0 && MIME[path.slice(i).toLowerCase()]) || 'application/octet-stream';
}

/**
 * Resolve a reference found in `fromPath` to a project path, or null when it is
 * not a project file (absolute URL, data URI, anchor) or escapes the project.
 */
export function resolvePath(fromPath, ref) {
  let r = String(ref ?? '').trim();
  if (r === '' || r.startsWith('#') || r.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(r)) return null; // http:, data:, blob:, javascript:...
  r = r.replace(/[?#].*$/, '');
  try {
    r = decodeURIComponent(r);
  } catch {
    return null;
  }
  const parts = r.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const seg of r.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length ? parts.join('/') : null;
}

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function dataUri(path, bytes) {
  return `data:${mimeFor(path)};base64,${toBase64(bytes)}`;
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

/** Replace url(...) references in a stylesheet with data URIs of project files. */
export function inlineCssUrls(css, cssPath, files) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote, ref) => {
    const target = resolvePath(cssPath, ref);
    const bytes = target && files.get(target);
    return bytes ? `url("${dataUri(target, bytes)}")` : whole;
  });
}

/** Neutralise anything that could end the inline script element early. */
export function escapeInlineScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * @param {Map<string, Uint8Array>} files   project files by path
 * @param {object} [options]
 * @param {string} [options.entry]
 * @param {new () => DOMParser} [options.DOMParserImpl]
 * @returns {{html:string, warnings:string[]}}
 */
export function buildPreviewDocument(files, { entry = 'index.html', DOMParserImpl = globalThis.DOMParser } = {}) {
  const warnings = [];
  const entryBytes = files.get(entry);
  if (!entryBytes) throw new Error(`No ${entry} in the project.`);
  if (!DOMParserImpl) throw new Error('DOMParser is not available in this environment.');

  const doc = new DOMParserImpl().parseFromString(decode(entryBytes), 'text/html');
  const missing = new Set();
  const fileFor = (ref) => {
    const target = resolvePath(entry, ref);
    if (!target) return null;
    const bytes = files.get(target);
    if (!bytes) {
      missing.add(target);
      return null;
    }
    return { path: target, bytes };
  };

  // Stylesheets -> <style>, with their url() references inlined.
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const f = fileFor(link.getAttribute('href'));
    if (!f) continue;
    const style = doc.createElement('style');
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    style.textContent = inlineCssUrls(decode(f.bytes), f.path, files);
    link.replaceWith(style);
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = inlineCssUrls(style.textContent, entry, files);
  }

  // Images, icons and other single-file resources -> data URIs.
  for (const [selector, attr] of [
    ['img[src]', 'src'],
    ['source[src]', 'src'],
    ['video[poster]', 'poster'],
    ['link[rel~="icon"][href]', 'href'],
    ['audio[src]', 'src'],
    ['video[src]', 'src'],
  ]) {
    for (const el of doc.querySelectorAll(selector)) {
      const f = fileFor(el.getAttribute(attr));
      if (f) el.setAttribute(attr, dataUri(f.path, f.bytes));
    }
  }

  // Scripts -> inline. `defer`/`async` scripts run after the document is parsed,
  // so they move to the end of <body>, in their original order.
  const deferred = [];
  for (const script of [...doc.querySelectorAll('script[src]')]) {
    const f = fileFor(script.getAttribute('src'));
    if (!f) continue;
    const inline = doc.createElement('script');
    const type = script.getAttribute('type');
    if (type && type !== 'text/javascript') inline.setAttribute('type', type);
    if (type === 'module') warnings.push('This project uses ES modules; imports between files are not resolved in the preview.');
    inline.textContent = escapeInlineScript(decode(f.bytes));
    if (script.hasAttribute('defer') || script.hasAttribute('async')) {
      deferred.push(inline);
      script.remove();
    } else {
      script.replaceWith(inline);
    }
  }
  for (const s of deferred) doc.body.appendChild(s);

  // Safety layer first, so it is in force before any project code runs.
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', CSP);
  const reporter = doc.createElement('script');
  reporter.textContent = ERROR_REPORTER;
  doc.head.prepend(reporter);
  doc.head.prepend(meta);

  for (const m of [...missing].sort()) warnings.push(`${m} is referenced but is not in the project.`);
  return { html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML, warnings };
}
