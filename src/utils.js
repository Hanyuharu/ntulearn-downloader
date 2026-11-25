/**
 * Utility helpers for NTULearn Downloader (Manifest V3).
 * Pure, dependency-free ES module with Windows path safety.
 */

const ILLEGAL_WIN_CHARS_RE = /[<>:"/\\|?*\x00-\x1f]/g;
const WIN_RESERVED_NAME_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const WIN_RESERVED_BASE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const TERM_TAG_RE = /^(\d{2}[A-Z]\d|\d{4}[-_]?S\d)/i;

const VIDEO_HOST_PATTERNS = [
  /echo360\./i,
  /panopto\./i,
  /kaltura\./i,
  /aculearn\./i,
  /yuja\./i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)youtu\.be$/i,
  /(?:^|\.)vimeo\.com$/i,
  /(?:^|\.)microsoftstream\.com$/i,
  /(?:^|\.)stream\.microsoft\.com$/i,
];

const VIDEO_EXT_RE = /\.(mp4|m3u8|mov|mkv|webm|avi|wmv|flv|m4v)$/i;
const DOC_EXT_RE = /\.(pdf|pptx?|docx?|xlsx?|csv|zip|rar|7z|tar|gz|txt|md|html?|rtf|ipynb|py|java|c|cpp|h|js|ts|json|xml|png|jpe?g|gif|svg|webp)$/i;
const VIDEO_LTI_TITLE_RE = /\b(echo360|panopto|kaltura|aculearn|yuja|recorded\s+lecture|lecture\s+recording|video\s+recording|microsoft\s+stream)\b/i;

const INTERNAL_FILE_PATH_RE = /(\/bbcswebdav\/|\/courses\/[^/]+\/.*\/embedded\/|\/learn\/api\/.*\/download(?:\b|\/|\?|$))/i;

/**
 * Sanitize a string for safe use as a Windows folder name.
 * @param {string} name
 * @param {number} [maxLen=70]
 * @returns {string}
 */
export function sanitizeFolderName(name, maxLen = 70) {
  let clean = String(name ?? '')
    .replace(ILLEGAL_WIN_CHARS_RE, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');

  if (maxLen > 0 && clean.length > maxLen) {
    clean = clean.slice(0, maxLen).replace(/[\s.]+$/g, '');
  }

  if (WIN_RESERVED_NAME_RE.test(clean)) {
    clean = `_${clean}`;
    if (maxLen > 0 && clean.length > maxLen) {
      clean = clean.slice(0, maxLen).replace(/[\s.]+$/g, '');
    }
  }

  return clean || 'Untitled';
}

/**
 * Sanitize a string for safe use as a Windows file name, preserving its extension when truncating.
 * @param {string} name
 * @param {number} [maxLen=95]
 * @returns {string}
 */
export function sanitizeFileName(name, maxLen = 95) {
  let clean = String(name ?? '')
    .replace(ILLEGAL_WIN_CHARS_RE, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');

  if (!clean) {
    return 'Untitled';
  }

  let base = clean;
  let ext = '';
  const lastDot = clean.lastIndexOf('.');
  if (lastDot > 0) {
    const candidateExt = clean.slice(lastDot);
    if (/^\.[A-Za-z0-9]{1,15}$/.test(candidateExt)) {
      base = clean.slice(0, lastDot).replace(/[\s.]+$/g, '');
      ext = candidateExt;
    }
  }

  if (!base) {
    base = 'Untitled';
  }

  if (WIN_RESERVED_BASE_RE.test(base)) {
    base = `_${base}`;
  }

  if (maxLen > 0 && base.length + ext.length > maxLen) {
    const maxBaseLen = Math.max(1, maxLen - ext.length);
    base = base.slice(0, maxBaseLen).replace(/[\s.]+$/g, '') || 'Untitled';
    if (WIN_RESERVED_BASE_RE.test(base)) {
      base = `_${base}`.slice(0, maxBaseLen);
    }
  }

  return `${base}${ext}`;
}

/**
 * Format a 1-based zero-padded order prefix such as "01_" (or "001_" when total >= 100).
 * @param {number} index 0-based item index
 * @param {number} total Total number of items at this level
 * @returns {string}
 */
export function formatIndexPrefix(index, total = 0) {
  const oneBased = Math.max(1, Math.floor(Number(index) || 0) + 1);
  const width = total >= 100 ? Math.max(3, String(total).length) : 2;
  return `${String(oneBased).padStart(width, '0')}_`;
}

/**
 * Extract semester/term tag from a course object (e.g. "25S1" from "25S1-CS1001-LEC").
 * @param {object} course
 * @returns {string}
 */
export function extractTermTag(course) {
  const courseId = String(course?.courseId || '').trim();
  const match = courseId.match(TERM_TAG_RE);
  if (match && match[1]) {
    return match[1].toUpperCase();
  }
  const termId = String(course?.termId || '').trim();
  return termId || 'Other';
}

/**
 * Build concise, Windows-safe course folder name.
 * @param {object} course
 * @returns {string}
 */
export function getCourseFolderName(course) {
  return sanitizeFolderName(course?.courseId || course?.name || course?.id || 'Course', 70);
}

/**
 * Determine whether a URL (or LTI video tool title) points to video content that should be skipped.
 * @param {string} url
 * @param {string} [title='']
 * @returns {boolean}
 */
export function isVideoUrl(url, title = '') {
  const rawUrl = String(url || '').trim();
  const rawTitle = String(title || '').trim();

  let parsed = null;
  if (rawUrl) {
    try {
      parsed = new URL(rawUrl, 'https://ntulearn.ntu.edu.sg');
    } catch {
      parsed = null;
    }
  }

  if (parsed) {
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const fullLower = parsed.href.toLowerCase();

    for (const pattern of VIDEO_HOST_PATTERNS) {
      if (pattern.test(host)) {
        return true;
      }
    }

    if (VIDEO_EXT_RE.test(pathname)) {
      return true;
    }

    // Detect SharePoint / Microsoft Stream video URLs or LTI video launch URLs
    if (
      (host.includes('sharepoint.com') && /stream|videoplayer/i.test(fullLower)) ||
      /\/(echo360|panopto|kaltura|aculearn|yuja)\b/i.test(fullLower)
    ) {
      return true;
    }

    // If URL clearly points to a downloadable document, don't misclassify by title
    if (DOC_EXT_RE.test(pathname)) {
      return false;
    }
  } else if (rawUrl) {
    if (VIDEO_EXT_RE.test(rawUrl.split(/[?#]/)[0])) {
      return true;
    }
    if (/(echo360|panopto|kaltura|aculearn|yuja|youtube\.com|youtu\.be|vimeo\.com|microsoftstream)/i.test(rawUrl)) {
      return true;
    }
  }

  // Fallback for LTI / embedded video tool items whose URL may be an opaque Blackboard launch URL
  if (rawTitle && VIDEO_LTI_TITLE_RE.test(rawTitle)) {
    if (
      !rawUrl ||
      /blti|lti|launch|ntulearn\.ntu\.edu\.sg\/webapps/i.test(rawUrl)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Decode common HTML entities for plain-text inspection.
 * @param {string} str
 * @returns {string}
 */
function decodeBasicEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

/**
 * Check whether an HTML fragment contains meaningful readable text or structured content.
 * @param {string} html
 * @returns {boolean}
 */
export function hasMeaningfulText(html) {
  if (!html || typeof html !== 'string') {
    return false;
  }

  if (/<(table|pre|code)\b/i.test(html)) {
    return true;
  }

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const plain = decodeBasicEntities(stripped).replace(/\s+/g, ' ').trim();
  return plain.length >= 15;
}

/**
 * Derive a clean filename from an internal file URL or fallback link text.
 * @param {string} urlStr
 * @param {string} linkText
 * @returns {string}
 */
function deriveEmbeddedFileName(urlStr, linkText = '') {
  let candidate = '';
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      let last = segments[segments.length - 1];
      if (last.toLowerCase() === 'download' && segments.length >= 2) {
        last = segments[segments.length - 2];
      }
      try {
        candidate = decodeURIComponent(last);
      } catch {
        candidate = last;
      }
    }
    const queryName = parsed.searchParams.get('filename') || parsed.searchParams.get('fileName');
    if (queryName) {
      candidate = queryName;
    }
  } catch {
    // Ignore URL parse error
  }

  const cleanLinkText = String(linkText || '').replace(/\s+/g, ' ').trim();
  if ((!candidate || !candidate.includes('.')) && cleanLinkText) {
    candidate = cleanLinkText;
  }

  return sanitizeFileName(candidate || 'embedded_file');
}

/**
 * Extract internal downloadable file links and external non-video links from HTML.
 * Uses DOMParser when available with a regex fallback.
 * @param {string} html
 * @param {string} [baseUrl='https://ntulearn.ntu.edu.sg']
 * @returns {{ internalFiles: Array<{ url: string, fileName: string, title: string }>, externalLinks: Array<{ url: string, title: string }> }}
 */
export function extractEmbeddedLinks(html, baseUrl = 'https://ntulearn.ntu.edu.sg') {
  const internalFiles = [];
  const externalLinks = [];

  if (!html || typeof html !== 'string') {
    return { internalFiles, externalLinks };
  }

  let baseOrigin = 'https://ntulearn.ntu.edu.sg';
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    // Use default
  }

  const seenInternal = new Set();
  const seenExternal = new Set();

  /** @type {Array<{ rawUrl: string, text: string, tag: string }>} */
  const candidates = [];

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      doc.querySelectorAll('a[href]').forEach((el) => {
        candidates.push({
          rawUrl: el.getAttribute('href') || '',
          text: (el.textContent || '').trim(),
          tag: 'a',
        });
      });

      doc.querySelectorAll('img[src], iframe[src], embed[src], source[src]').forEach((el) => {
        candidates.push({
          rawUrl: el.getAttribute('src') || '',
          text: el.getAttribute('alt') || el.getAttribute('title') || '',
          tag: el.tagName.toLowerCase(),
        });
      });

      doc.querySelectorAll('object[data]').forEach((el) => {
        candidates.push({
          rawUrl: el.getAttribute('data') || '',
          text: el.getAttribute('title') || '',
          tag: 'object',
        });
      });
    } catch {
      // Fall through to regex extraction if DOMParser fails
    }
  }

  if (candidates.length === 0) {
    // Regex fallback for non-DOM environments or failed DOMParser
    const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const rawUrl = decodeBasicEntities(m[1] ?? m[2] ?? m[3] ?? '');
      const innerText = decodeBasicEntities((m[4] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      candidates.push({ rawUrl, text: innerText, tag: 'a' });
    }

    const mediaRe = /<(img|iframe|embed|source|object)\b[^>]*\b(?:src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    while ((m = mediaRe.exec(html)) !== null) {
      const tag = (m[1] || '').toLowerCase();
      const rawUrl = decodeBasicEntities(m[2] ?? m[3] ?? m[4] ?? '');
      candidates.push({ rawUrl, text: '', tag });
    }
  }

  for (const { rawUrl, text, tag } of candidates) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(trimmed)) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(trimmed, baseUrl);
    } catch {
      continue;
    }

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      continue;
    }

    const href = resolved.href;
    if (isVideoUrl(href, text)) {
      continue;
    }

    if (INTERNAL_FILE_PATH_RE.test(resolved.pathname)) {
      const key = href.toLowerCase();
      if (!seenInternal.has(key)) {
        seenInternal.add(key);
        const fileName = deriveEmbeddedFileName(href, text);
        internalFiles.push({
          url: href,
          fileName,
          title: text || fileName,
        });
      }
      continue;
    }

    // Only collect external links from anchor tags pointing outside NTULearn
    if (tag === 'a' && resolved.origin.toLowerCase() !== baseOrigin.toLowerCase()) {
      const key = href.toLowerCase();
      if (!seenExternal.has(key)) {
        seenExternal.add(key);
        externalLinks.push({
          url: href,
          title: text || href,
        });
      }
    }
  }

  return { internalFiles, externalLinks };
}

/**
 * Escape HTML special characters for safe interpolation in text/attributes.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a clean standalone UTF-8 HTML document wrapping Blackboard body HTML.
 * @param {string} title
 * @param {string} bodyHtml
 * @param {string} [sourceUrl='']
 * @returns {string}
 */
export function buildNotesHtml(title, bodyHtml, sourceUrl = '') {
  const safeTitle = escapeHtml(title || 'Course Notes');
  const safeSource = sourceUrl
    ? `<p class="source-link">Source: <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceUrl)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      max-width: 900px;
      margin: 2rem auto;
      padding: 0 1.25rem;
    }
    header {
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
    }
    h1 {
      font-size: 1.5rem;
      margin: 0 0 0.35rem 0;
      color: #111827;
    }
    .source-link {
      font-size: 0.85rem;
      color: #6b7280;
      margin: 0;
      word-break: break-all;
    }
    .source-link a {
      color: #2563eb;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    pre, code {
      background: #f3f4f6;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    pre {
      padding: 0.85rem 1rem;
      overflow-x: auto;
    }
    code {
      padding: 0.15rem 0.35rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    ${safeSource}
  </header>
  <main>
${String(bodyHtml || '')}
  </main>
</body>
</html>
`;
}

/**
 * Format an array of link objects into deduplicated readable plain text.
 * @param {Array<{ title?: string, url: string }>} links
 * @returns {string}
 */
export function formatLinksTxt(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return '';
  }

  const seen = new Set();
  const blocks = [];

  for (const item of links) {
    const url = String(item?.url || '').trim();
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const title = String(item?.title || '').replace(/\s+/g, ' ').trim() || url;
    blocks.push(`${title}\n${url}`);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

/**
 * Deduplicate a relative path case-insensitively within a scan run.
 * Inserts " (2)", " (3)", ... before the file extension (or at the end).
 * @param {string} relativePath
 * @param {Set<string>} usedSet
 * @returns {string}
 */
export function dedupeRelativePath(relativePath, usedSet) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!(usedSet instanceof Set)) {
    return normalized;
  }

  if (!usedSet.has(normalized.toLowerCase())) {
    usedSet.add(normalized.toLowerCase());
    return normalized;
  }

  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  let base = file;
  let ext = '';
  const lastDot = file.lastIndexOf('.');
  if (lastDot > 0) {
    const candidateExt = file.slice(lastDot);
    if (/^\.[A-Za-z0-9]{1,15}$/.test(candidateExt)) {
      base = file.slice(0, lastDot);
      ext = candidateExt;
    }
  }

  let counter = 2;
  let candidate = `${dir}${base} (${counter})${ext}`;
  while (usedSet.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${dir}${base} (${counter})${ext}`;
  }

  usedSet.add(candidate.toLowerCase());
  return candidate;
}
