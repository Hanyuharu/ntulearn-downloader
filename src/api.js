/**
 * NTULearn (Blackboard Learn Ultra) REST API client & course content scanner.
 */

import {
  sanitizeFolderName,
  sanitizeFileName,
  formatIndexPrefix,
  extractTermTag,
  getCourseFolderName,
  isVideoUrl,
  hasMeaningfulText,
  extractEmbeddedLinks,
  buildNotesHtml,
  formatLinksTxt,
  dedupeRelativePath,
} from './utils.js';

export const BASE_URL = 'https://ntulearn.ntu.edu.sg';

const MAX_PAGES = 50;
const MAX_RELATIVE_PATH_LEN = 210;

const FOLDER_HANDLERS = new Set([
  'resource/x-bb-folder',
  'resource/x-bb-lesson',
  'resource/x-learn-folder',
]);

const ASSIGNMENT_HANDLERS = new Set([
  'resource/x-bb-assignment',
  'resource/x-bb-asmt-test-link',
  'resource/x-bb-turnitin-assignment',
]);

/**
 * Resolve a relative or absolute API path against BASE_URL.
 * @param {string} pathOrUrl
 * @returns {string}
 */
function resolveApiUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, BASE_URL).href;
}

/**
 * Create an AbortError consistent across browsers.
 * @returns {Error}
 */
function createAbortError() {
  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Perform an authenticated JSON GET request against NTULearn.
 * @param {string} pathOrUrl
 * @param {AbortSignal|null} [signal=null]
 * @returns {Promise<any>}
 */
async function fetchJson(pathOrUrl, signal = null) {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const url = resolveApiUrl(pathOrUrl);
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    signal: signal || undefined,
  });

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    err.status = res.status;
    err.url = url;
    throw err;
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('json')) {
    const err = new Error('Unexpected non-JSON response (session may have expired)');
    err.status = 401;
    err.url = url;
    throw err;
  }

  return res.json();
}

/**
 * Paginate a Blackboard Learn REST endpoint following `data.paging.nextPage`.
 * @param {string} initialPath
 * @param {AbortSignal|null} [signal=null]
 * @returns {Promise<Array<any>>}
 */
async function fetchAllPages(initialPath, signal = null) {
  const results = [];
  const visited = new Set();
  let nextUrl = resolveApiUrl(initialPath);
  let pageCount = 0;

  while (nextUrl && pageCount < MAX_PAGES) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (visited.has(nextUrl)) {
      break;
    }
    visited.add(nextUrl);
    pageCount += 1;

    const data = await fetchJson(nextUrl, signal);
    if (Array.isArray(data?.results)) {
      results.push(...data.results);
    }

    const rawNext = data?.paging?.nextPage;
    nextUrl = rawNext ? resolveApiUrl(rawNext) : null;
  }

  return results;
}

/**
 * Format Blackboard user name field (object or string) into a readable string.
 * @param {any} user
 * @returns {string}
 */
function formatUserDisplayName(user) {
  const nameObj = user?.name;
  if (typeof nameObj === 'string' && nameObj.trim()) {
    return nameObj.trim();
  }
  if (nameObj && typeof nameObj === 'object') {
    const parts = [nameObj.given, nameObj.middle, nameObj.family]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }
  return String(user?.userName || 'NTULearn User');
}

/**
 * Check whether the user currently has an active NTULearn session.
 * Falls back to `/users/me/courses?limit=1` if `/users/me` returns 403/404.
 * @returns {Promise<{ loggedIn: boolean, user?: { id: string, userName: string, name: string }, error?: string }>}
 */
export async function checkLogin() {
  try {
    const data = await fetchJson('/learn/api/public/v1/users/me');
    return {
      loggedIn: true,
      user: {
        id: String(data?.id || 'me'),
        userName: String(data?.userName || ''),
        name: formatUserDisplayName(data),
      },
    };
  } catch (err) {
    if (err?.status === 403 || err?.status === 404) {
      try {
        await fetchJson('/learn/api/public/v1/users/me/courses?limit=1');
        return {
          loggedIn: true,
          user: {
            id: 'me',
            userName: '',
            name: 'NTULearn User',
          },
        };
      } catch (fallbackErr) {
        return {
          loggedIn: false,
          error: fallbackErr?.message || 'Not logged in to NTULearn',
        };
      }
    }
    return {
      loggedIn: false,
      error: err?.message || 'Not logged in to NTULearn',
    };
  }
}

/**
 * Fetch all enrolled courses for the current user.
 * Returns all courses including those where `course.availability.available === "No"`.
 * @returns {Promise<Array<{ id: string, courseId: string, name: string, termTag: string, available: boolean, enrollmentAvailable: boolean, role: string, folderName: string, externalAccessUrl: string }>>}
 */
export async function getCourses() {
  const enrollments = await fetchAllPages(
    '/learn/api/public/v1/users/me/courses?expand=course&limit=100'
  );

  const courses = [];
  for (const item of enrollments) {
    const c = item?.course || {};
    const id = String(item?.courseId || c?.id || '').trim();
    if (!id) continue;

    const courseId = String(c?.courseId || id).trim();
    const name = String(c?.name || courseId || id).trim();
    const termTag = extractTermTag({ courseId, termId: c?.termId });
    const folderName = getCourseFolderName({ id, courseId, name });
    const externalAccessUrl =
      c?.externalAccessUrl || `${BASE_URL}/ultra/courses/${encodeURIComponent(id)}/outline`;

    courses.push({
      id,
      courseId,
      name,
      termTag,
      available: c?.availability?.available === 'Yes',
      enrollmentAvailable: item?.availability?.available === 'Yes',
      role: String(item?.courseRoleId || ''),
      folderName,
      externalAccessUrl,
    });
  }

  return courses;
}

/**
 * Sort content items by `position` ascending, falling back to original order.
 * @param {Array<any>} items
 * @returns {Array<any>}
 */
function sortByPosition(items) {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const posA = typeof a.item?.position === 'number' ? a.item.position : Number.POSITIVE_INFINITY;
      const posB = typeof b.item?.position === 'number' ? b.item.position : Number.POSITIVE_INFINITY;
      if (posA !== posB) return posA - posB;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.item);
}

/**
 * Build a Windows-safe, deduplicated relative path within MAX_RELATIVE_PATH_LEN.
 * Preserves rootFolder (index 0) and courseFolder (index 1) while trimming long middle segments if needed.
 * @param {string[]} folderSegments
 * @param {string} fileName
 * @param {Set<string>} usedPaths
 * @returns {string}
 */
function buildSafeRelativePath(folderSegments, fileName, usedPaths) {
  let segs = folderSegments.slice();
  let safeFile = sanitizeFileName(fileName, 95);

  const joinPath = (folders, file) => [...folders, file].join('/');

  if (joinPath(segs, safeFile).length > MAX_RELATIVE_PATH_LEN && segs.length > 2) {
    for (const cap of [40, 28, 18, 12]) {
      segs = segs.map((seg, i) => (i < 2 ? seg : sanitizeFolderName(seg, cap)));
      if (joinPath(segs, safeFile).length <= MAX_RELATIVE_PATH_LEN) {
        break;
      }
    }
  }

  if (joinPath(segs, safeFile).length > MAX_RELATIVE_PATH_LEN) {
    const dirLen = segs.join('/').length + 1;
    const remaining = Math.max(20, MAX_RELATIVE_PATH_LEN - dirLen);
    safeFile = sanitizeFileName(safeFile, remaining);
  }

  return dedupeRelativePath(joinPath(segs, safeFile), usedPaths);
}

/**
 * Fetch attachments for a content item, ignoring 403/404 gracefully.
 * @param {string} courseId
 * @param {string} contentId
 * @param {AbortSignal|null} signal
 * @returns {Promise<Array<any>>}
 */
async function fetchItemAttachments(courseId, contentId, signal) {
  const path = `/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/attachments?limit=100`;
  try {
    return await fetchAllPages(path, signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.status === 404 || err?.status === 403 || err?.status === 400) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetch internal v1 content detail (contains `body.displayText`, `body.rawText`, `contentDetail`).
 * Ignores errors gracefully and returns null.
 * @param {string} courseId
 * @param {string} contentId
 * @param {AbortSignal|null} signal
 * @returns {Promise<any|null>}
 */
async function fetchInternalContentDetail(courseId, contentId, signal) {
  const path = `/learn/api/v1/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}`;
  try {
    return await fetchJson(path, signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Recursively scan a course's content tree and produce download tasks.
 * @param {object} course Normalized course object from `getCourses()`
 * @param {object} [options={}]
 * @param {function|null} [onProgress=null]
 * @param {AbortSignal|null} [signal=null]
 * @returns {Promise<{ course: object, tasks: Array<object>, stats: { folders: number, files: number, notes: number, links: number, skippedVideos: number }, errors: Array<string> }>}
 */
export async function scanCourse(course, options = {}, onProgress = null, signal = null) {
  const {
    rootFolder = 'NTUlearn',
    useOrderPrefix = true,
    includeNotes = true,
    includeLinks = true,
    includeAssignments = true,
  } = options || {};

  const stats = {
    folders: 0,
    files: 0,
    notes: 0,
    links: 0,
    skippedVideos: 0,
  };
  const tasks = [];
  const errors = [];
  const usedPaths = new Set();

  const safeRoot = sanitizeFolderName(rootFolder, 50);
  const safeCourseFolder = sanitizeFolderName(
    course?.folderName || getCourseFolderName(course),
    70
  );
  const baseSegments = [safeRoot, safeCourseFolder];
  const courseOutlineUrl =
    course?.externalAccessUrl ||
    `${BASE_URL}/ultra/courses/${encodeURIComponent(course.id)}/outline`;

  const emitProgress = (currentTitle) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress({
          phase: 'scanning',
          courseId: course.id,
          courseName: course.name,
          currentTitle: currentTitle || '',
          stats: { ...stats },
        });
      } catch {
        // Ignore progress callback errors
      }
    }
  };

  /**
   * Process a single level of content items inside `folderSegments`.
   * @param {Array<any>} items
   * @param {string[]} folderSegments
   * @param {string} folderKey
   */
  async function processLevel(items, folderSegments, folderKey) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    const sorted = sortByPosition(items);
    const folderLinks = [];

    for (let idx = 0; idx < sorted.length; idx += 1) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const item = sorted[idx];
      if (!item || !item.id) continue;

      const title = String(item.title || 'Untitled').trim();
      const handlerId = String(item.contentHandler?.id || '').toLowerCase();
      const handlerUrl = String(item.contentHandler?.url || '').trim();
      const isFolder = item.hasChildren === true || FOLDER_HANDLERS.has(handlerId);

      // Skip video items (Echo360, Panopto, Kaltura, AcuLearn, YuJa, YouTube, etc.)
      if (!isFolder && isVideoUrl(handlerUrl, title)) {
        stats.skippedVideos += 1;
        continue;
      }

      // Recurse into folders / learning modules
      if (isFolder) {
        stats.folders += 1;
        emitProgress(title);

        const prefix = useOrderPrefix ? formatIndexPrefix(idx, sorted.length) : '';
        const folderSeg = sanitizeFolderName(`${prefix}${sanitizeFolderName(title, 70)}`, 75);
        const childSegments = [...folderSegments, folderSeg];

        try {
          const children = await fetchAllPages(
            `/learn/api/public/v1/courses/${encodeURIComponent(course.id)}/contents/${encodeURIComponent(item.id)}/children?limit=100`,
            signal
          );
          await processLevel(children, childSegments, item.id);
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          if (err?.status !== 404) {
            errors.push(`Folder "${title}": ${err?.message || String(err)}`);
          }
        }
        continue;
      }

      // External link item
      if (handlerId === 'resource/x-bb-externallink') {
        if (handlerUrl && !isVideoUrl(handlerUrl, title)) {
          folderLinks.push({ title, url: handlerUrl });
        }
        continue;
      }

      // Optional assignment filtering
      if (ASSIGNMENT_HANDLERS.has(handlerId) && !includeAssignments) {
        continue;
      }

      emitProgress(title);

      // Fetch attachments for leaf item
      let rawAttachments = [];
      try {
        rawAttachments = await fetchItemAttachments(course.id, item.id, signal);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        errors.push(`Attachments "${title}": ${err?.message || String(err)}`);
      }

      const itemFiles = [];
      const seenFileUrls = new Set();

      for (const att of rawAttachments) {
        if (!att || !att.id) continue;
        const attName = String(att.fileName || title || 'file').trim();
        if (isVideoUrl(attName, attName)) {
          stats.skippedVideos += 1;
          continue;
        }
        const downloadUrl = `${BASE_URL}/learn/api/public/v1/courses/${encodeURIComponent(course.id)}/contents/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(att.id)}/download`;
        seenFileUrls.add(downloadUrl.toLowerCase());
        itemFiles.push({
          key: `${course.id}:att:${item.id}:${att.id}`,
          fileName: sanitizeFileName(attName),
          url: downloadUrl,
          mimeType: String(att.mimeType || ''),
          title: attName,
        });
      }

      // Inspect body HTML (fetch internal v1 detail for documents or when no attachments found)
      let bodyHtml = typeof item.body === 'string' ? item.body : '';
      const shouldFetchDetail =
        handlerId === 'resource/x-bb-document' ||
        (itemFiles.length === 0 && handlerId !== 'resource/x-bb-blti-link');

      if (shouldFetchDetail) {
        const detail = await fetchInternalContentDetail(course.id, item.id, signal);
        if (detail) {
          const detailBody = detail?.body?.displayText || detail?.body?.rawText || '';
          if (detailBody) {
            bodyHtml = detailBody;
          }
          // Fallback: internal file permanentUrl when /attachments returned nothing
          const permUrl = detail?.contentDetail?.['resource/x-bb-file']?.file?.permanentUrl;
          const permName = detail?.contentDetail?.['resource/x-bb-file']?.file?.fileName;
          if (itemFiles.length === 0 && permUrl) {
            const fullPermUrl = resolveApiUrl(permUrl);
            if (!isVideoUrl(fullPermUrl, permName || title)) {
              seenFileUrls.add(fullPermUrl.toLowerCase());
              const fName = sanitizeFileName(permName || title || 'file');
              itemFiles.push({
                key: `${course.id}:file:${item.id}:${fName}`,
                fileName: fName,
                url: fullPermUrl,
                mimeType: '',
                title: permName || title,
              });
            } else {
              stats.skippedVideos += 1;
            }
          }
        }
      }

      // Extract embedded internal files and external links from body HTML
      const { internalFiles, externalLinks } = extractEmbeddedLinks(bodyHtml, BASE_URL);
      for (const emb of internalFiles) {
        const urlKey = emb.url.toLowerCase();
        if (seenFileUrls.has(urlKey)) continue;
        seenFileUrls.add(urlKey);
        itemFiles.push({
          key: `${course.id}:emb:${item.id}:${emb.url}`,
          fileName: emb.fileName,
          url: emb.url,
          mimeType: '',
          title: emb.title || emb.fileName,
        });
      }

      const meaningfulBody = hasMeaningfulText(bodyHtml);

      // Smart Ultra Document rule:
      // 1 file + no meaningful body text => place directly in parent folder (no redundant subfolder).
      if (itemFiles.length === 1 && !meaningfulBody) {
        const file = itemFiles[0];
        const relativePath = buildSafeRelativePath(folderSegments, file.fileName, usedPaths);
        tasks.push({
          key: file.key,
          type: 'file',
          courseId: course.id,
          courseCode: safeCourseFolder,
          courseName: course.name,
          title: file.title,
          fileName: file.fileName,
          relativePath,
          url: file.url,
          mimeType: file.mimeType,
        });
        stats.files += 1;

        if (externalLinks.length > 0) {
          folderLinks.push(...externalLinks);
        }
        continue;
      }

      // Multiple files OR meaningful body text => create item subfolder
      if (itemFiles.length >= 2 || (meaningfulBody && (includeNotes || itemFiles.length > 0))) {
        const prefix = useOrderPrefix ? formatIndexPrefix(idx, sorted.length) : '';
        const subSeg = sanitizeFolderName(`${prefix}${sanitizeFolderName(title, 70)}`, 75);
        const itemSegments = [...folderSegments, subSeg];
        stats.folders += 1;

        for (const file of itemFiles) {
          const relativePath = buildSafeRelativePath(itemSegments, file.fileName, usedPaths);
          tasks.push({
            key: file.key,
            type: 'file',
            courseId: course.id,
            courseCode: safeCourseFolder,
            courseName: course.name,
            title: file.title,
            fileName: file.fileName,
            relativePath,
            url: file.url,
            mimeType: file.mimeType,
          });
          stats.files += 1;
        }

        if (meaningfulBody && includeNotes) {
          const notesHtml = buildNotesHtml(title, bodyHtml, courseOutlineUrl);
          const relativePath = buildSafeRelativePath(itemSegments, '_notes.html', usedPaths);
          tasks.push({
            key: `${course.id}:notes:${item.id}`,
            type: 'notes',
            courseId: course.id,
            courseCode: safeCourseFolder,
            courseName: course.name,
            title: `${title} (Notes)`,
            fileName: '_notes.html',
            relativePath,
            url: null,
            content: notesHtml,
            mimeType: 'text/html;charset=utf-8',
          });
          stats.notes += 1;
        }

        if (externalLinks.length > 0 && includeLinks) {
          const linksTxt = formatLinksTxt(externalLinks);
          if (linksTxt) {
            const relativePath = buildSafeRelativePath(itemSegments, '_links.txt', usedPaths);
            tasks.push({
              key: `${course.id}:links:${item.id}`,
              type: 'links',
              courseId: course.id,
              courseCode: safeCourseFolder,
              courseName: course.name,
              title: `${title} (Links)`,
              fileName: '_links.txt',
              relativePath,
              url: null,
              content: linksTxt,
              mimeType: 'text/plain;charset=utf-8',
            });
            stats.links += 1;
          }
        }
        continue;
      }

      // 0 files & no meaningful notes (or notes disabled) — keep any external links at folder level
      if (externalLinks.length > 0) {
        folderLinks.push(...externalLinks);
      }
    }

    // Emit one `_links.txt` for all non-video external links collected in this folder
    if (includeLinks && folderLinks.length > 0) {
      const linksTxt = formatLinksTxt(folderLinks);
      if (linksTxt) {
        const relativePath = buildSafeRelativePath(folderSegments, '_links.txt', usedPaths);
        tasks.push({
          key: `${course.id}:links:${folderKey}`,
          type: 'links',
          courseId: course.id,
          courseCode: safeCourseFolder,
          courseName: course.name,
          title: `${folderSegments[folderSegments.length - 1]} (Links)`,
          fileName: '_links.txt',
          relativePath,
          url: null,
          content: linksTxt,
          mimeType: 'text/plain;charset=utf-8',
        });
        stats.links += 1;
      }
    }
  }

  try {
    emitProgress(course.name);
    const rootItems = await fetchAllPages(
      `/learn/api/public/v1/courses/${encodeURIComponent(course.id)}/contents?limit=100`,
      signal
    );
    await processLevel(rootItems, baseSegments, 'root');
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    errors.push(`Course "${course.name}": ${err?.message || String(err)}`);
  }

  return { course, tasks, stats, errors };
}
