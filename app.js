import { BASE_URL, checkLogin, getCourses, scanCourse } from './src/api.js';
import {
  getDownloadHistory,
  clearDownloadHistory,
  runDownloadQueue,
} from './src/downloader.js';

const SETTINGS_STORAGE_KEY = 'ntulearn_downloader_settings';
const MAX_LOG_ENTRIES = 500;

const DEFAULT_SETTINGS = {
  rootFolder: 'NTUlearn',
  useOrderPrefix: true,
  skipDownloaded: true,
  includeNotes: true,
  includeLinks: true,
  includeAssignments: true,
  concurrency: 3,
  tipDismissed: false,
};

const state = {
  loggedIn: false,
  user: null,
  courses: [],
  selectedCourseIds: new Set(),
  courseSearch: '',
  selectedTerm: '__ALL__',

  // Scan results
  scannedCourses: new Map(), // courseId -> { course, stats, errors }
  tasks: [],
  selectedTaskKeys: new Set(),
  taskRuntimeStatus: new Map(), // key -> { status: 'downloading'|'downloaded'|'skipped'|'failed', error?: string }
  collapsedGroups: new Set(),
  previewTypeFilter: 'all',
  previewSearch: '',

  // Download history & queue
  downloadHistory: {},
  failedTasks: [],

  // Busy flags
  isScanning: false,
  isDownloading: false,
  scanAbortController: null,
  downloadAbortController: null,

  // Settings
  settings: { ...DEFAULT_SETTINGS },
};

// DOM references
const dom = {
  loginStatusBadge: document.getElementById('loginStatusBadge'),
  loginStatusText: document.getElementById('loginStatusText'),
  openNtulBtn: document.getElementById('openNtulBtn'),
  refreshLoginBtn: document.getElementById('refreshLoginBtn'),

  tipBanner: document.getElementById('tipBanner'),
  dismissTipBtn: document.getElementById('dismissTipBtn'),

  rootFolderInput: document.getElementById('rootFolderInput'),
  pathPreviewHint: document.getElementById('pathPreviewHint'),
  concurrencySelect: document.getElementById('concurrencySelect'),
  historyCountBadge: document.getElementById('historyCountBadge'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),

  optOrderPrefix: document.getElementById('optOrderPrefix'),
  optSkipDownloaded: document.getElementById('optSkipDownloaded'),
  optIncludeNotes: document.getElementById('optIncludeNotes'),
  optIncludeLinks: document.getElementById('optIncludeLinks'),
  optIncludeAssignments: document.getElementById('optIncludeAssignments'),

  courseSelectionBadge: document.getElementById('courseSelectionBadge'),
  reloadCoursesBtn: document.getElementById('reloadCoursesBtn'),
  courseSearchInput: document.getElementById('courseSearchInput'),
  termFilterSelect: document.getElementById('termFilterSelect'),
  selectAllCoursesBtn: document.getElementById('selectAllCoursesBtn'),
  deselectAllCoursesBtn: document.getElementById('deselectAllCoursesBtn'),
  courseFilterInfo: document.getElementById('courseFilterInfo'),
  courseListContainer: document.getElementById('courseListContainer'),

  scanBtn: document.getElementById('scanBtn'),
  stopScanBtn: document.getElementById('stopScanBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  stopDownloadBtn: document.getElementById('stopDownloadBtn'),
  retryFailedBtn: document.getElementById('retryFailedBtn'),
  retryFailedCount: document.getElementById('retryFailedCount'),
  currentActionStatus: document.getElementById('currentActionStatus'),

  statCourses: document.getElementById('statCourses'),
  statFiles: document.getElementById('statFiles'),
  statNotes: document.getElementById('statNotes'),
  statLinks: document.getElementById('statLinks'),
  statSkippedVideos: document.getElementById('statSkippedVideos'),
  statWillSkip: document.getElementById('statWillSkip'),

  previewCountBadge: document.getElementById('previewCountBadge'),
  previewSearchInput: document.getElementById('previewSearchInput'),
  selectAllTasksBtn: document.getElementById('selectAllTasksBtn'),
  deselectAllTasksBtn: document.getElementById('deselectAllTasksBtn'),
  toggleCollapseAllBtn: document.getElementById('toggleCollapseAllBtn'),
  previewSelectedHint: document.getElementById('previewSelectedHint'),
  previewContainer: document.getElementById('previewContainer'),
  typeFilterChips: Array.from(document.querySelectorAll('[data-type-filter]')),

  progCompleted: document.getElementById('progCompleted'),
  progTotal: document.getElementById('progTotal'),
  progDownloaded: document.getElementById('progDownloaded'),
  progSkipped: document.getElementById('progSkipped'),
  progFailed: document.getElementById('progFailed'),
  progPercent: document.getElementById('progPercent'),
  progressBarTrack: document.getElementById('progressBarTrack'),
  progressBarFill: document.getElementById('progressBarFill'),

  clearLogBtn: document.getElementById('clearLogBtn'),
  logContainer: document.getElementById('logContainer'),
};

// -------------------- Utilities --------------------

function formatTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function addLog(message, level = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;

  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = `[${formatTime()}]`;

  const msgEl = document.createElement('span');
  msgEl.className = 'log-msg';
  msgEl.textContent = message;

  line.appendChild(timeEl);
  line.appendChild(msgEl);
  dom.logContainer.appendChild(line);

  while (dom.logContainer.children.length > MAX_LOG_ENTRIES) {
    dom.logContainer.removeChild(dom.logContainer.firstChild);
  }
  dom.logContainer.scrollTop = dom.logContainer.scrollHeight;
}

function getEffectiveRootFolder() {
  const raw = (state.settings.rootFolder || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
  return raw || 'NTUlearn';
}

function updatePathPreviewHint() {
  const root = getEffectiveRootFolder();
  dom.pathPreviewHint.textContent = `默认下载目录 / ${root} / <课程代码> / ...`;
}

function isBusy() {
  return state.isScanning || state.isDownloading;
}

// -------------------- Settings Persistence --------------------

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    if (stored && stored[SETTINGS_STORAGE_KEY]) {
      state.settings = { ...DEFAULT_SETTINGS, ...stored[SETTINGS_STORAGE_KEY] };
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
  applySettingsToUI();
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: state.settings });
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

function applySettingsToUI() {
  dom.rootFolderInput.value = state.settings.rootFolder;
  dom.concurrencySelect.value = String(state.settings.concurrency);
  dom.optOrderPrefix.checked = Boolean(state.settings.useOrderPrefix);
  dom.optSkipDownloaded.checked = Boolean(state.settings.skipDownloaded);
  dom.optIncludeNotes.checked = Boolean(state.settings.includeNotes);
  dom.optIncludeLinks.checked = Boolean(state.settings.includeLinks);
  dom.optIncludeAssignments.checked = Boolean(state.settings.includeAssignments);

  if (state.settings.tipDismissed) {
    dom.tipBanner.classList.add('hidden');
  } else {
    dom.tipBanner.classList.remove('hidden');
  }
  updatePathPreviewHint();
}

function readScanOptions() {
  return {
    rootFolder: getEffectiveRootFolder(),
    useOrderPrefix: Boolean(state.settings.useOrderPrefix),
    includeNotes: Boolean(state.settings.includeNotes),
    includeLinks: Boolean(state.settings.includeLinks),
    includeAssignments: Boolean(state.settings.includeAssignments),
  };
}

// -------------------- Download History --------------------

async function refreshDownloadHistory() {
  try {
    const history = await getDownloadHistory();
    state.downloadHistory = history && typeof history === 'object' ? history : {};
  } catch (err) {
    state.downloadHistory = {};
    addLog(`读取本地下载记录失败：${err.message || err}`, 'warn');
  }
  const count = Object.keys(state.downloadHistory).length;
  dom.historyCountBadge.textContent = `已记录 ${count} 项`;
  dom.clearHistoryBtn.disabled = count === 0 || isBusy();
  updateStatsUI();
  renderPreviewTree();
}

async function handleClearHistory() {
  const count = Object.keys(state.downloadHistory).length;
  if (count === 0) return;
  const confirmed = window.confirm(
    `确定要清除全部 ${count} 条本地下载记录吗？\n清除后，增量同步将重新下载所有选中的文件（不会删除硬盘上已存在的文件）。`
  );
  if (!confirmed) return;

  try {
    await clearDownloadHistory();
    addLog(`已清除 ${count} 条本地下载记录。`, 'info');
    await refreshDownloadHistory();
  } catch (err) {
    addLog(`清除下载记录失败：${err.message || err}`, 'error');
  }
}

// -------------------- Login & Courses --------------------

function setLoginBadge(status, text) {
  dom.loginStatusBadge.classList.remove('status-checking', 'status-online', 'status-offline');
  dom.loginStatusBadge.classList.add(`status-${status}`);
  dom.loginStatusText.textContent = text;
}

async function refreshLoginAndCourses() {
  if (isBusy()) return;
  setLoginBadge('checking', '正在检查登录状态...');
  dom.refreshLoginBtn.disabled = true;
  dom.reloadCoursesBtn.disabled = true;

  try {
    const res = await checkLogin();
    if (res && res.loggedIn) {
      state.loggedIn = true;
      state.user = res.user || null;
      const displayName =
        (res.user && (res.user.name || res.user.userName)) || '已登录';
      setLoginBadge('online', `已登录：${displayName}`);
      addLog(`登录状态正常（${displayName}），正在获取课程列表...`, 'success');
      await loadCourses();
    } else {
      state.loggedIn = false;
      state.user = null;
      state.courses = [];
      state.selectedCourseIds.clear();
      setLoginBadge('offline', '未登录 NTULearn');
      const reason = res && res.error ? `（${res.error}）` : '';
      addLog(`未检测到有效登录会话${reason}。请先打开 NTULearn 登录后再点击「刷新登录状态」。`, 'warn');
      populateTermFilter();
      renderCourseList();
    }
  } catch (err) {
    state.loggedIn = false;
    setLoginBadge('offline', '登录检查失败');
    addLog(`检查登录状态出错：${err.message || err}`, 'error');
    renderCourseList();
  } finally {
    dom.refreshLoginBtn.disabled = false;
    dom.reloadCoursesBtn.disabled = !state.loggedIn;
    updateActionButtons();
  }
}

async function loadCourses() {
  dom.courseListContainer.innerHTML =
    '<div class="empty-state"><p>正在加载课程列表...</p></div>';
  try {
    const courses = await getCourses();
    state.courses = Array.isArray(courses) ? courses : [];
    // Keep only valid selections if reloading
    const validIds = new Set(state.courses.map((c) => c.id));
    for (const id of Array.from(state.selectedCourseIds)) {
      if (!validIds.has(id)) state.selectedCourseIds.delete(id);
    }
    populateTermFilter();
    renderCourseList();
    addLog(`已加载 ${state.courses.length} 门课程。`, 'info');
  } catch (err) {
    state.courses = [];
    dom.courseListContainer.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>加载课程失败</p>';
    const sub = document.createElement('p');
    sub.className = 'empty-sub';
    sub.textContent = err.message || String(err);
    empty.appendChild(sub);
    dom.courseListContainer.appendChild(empty);
    addLog(`获取课程列表失败：${err.message || err}`, 'error');
  } finally {
    updateActionButtons();
  }
}

function populateTermFilter() {
  const prev = state.selectedTerm;
  const terms = new Set();
  for (const c of state.courses) {
    if (c.termTag) terms.add(c.termTag);
  }
  // Sort descending so newest term (e.g. 26S1, 25S2) appears first
  const sortedTerms = Array.from(terms).sort((a, b) => b.localeCompare(a));

  dom.termFilterSelect.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '__ALL__';
  allOpt.textContent = `全部学期 (${state.courses.length})`;
  dom.termFilterSelect.appendChild(allOpt);

  for (const term of sortedTerms) {
    const count = state.courses.filter((c) => c.termTag === term).length;
    const opt = document.createElement('option');
    opt.value = term;
    opt.textContent = `${term} (${count})`;
    dom.termFilterSelect.appendChild(opt);
  }

  if (prev !== '__ALL__' && terms.has(prev)) {
    state.selectedTerm = prev;
  } else {
    state.selectedTerm = '__ALL__';
  }
  dom.termFilterSelect.value = state.selectedTerm;
}

function getFilteredCourses() {
  const q = state.courseSearch.trim().toLowerCase();
  return state.courses.filter((c) => {
    if (state.selectedTerm !== '__ALL__' && c.termTag !== state.selectedTerm) {
      return false;
    }
    if (!q) return true;
    const hay = `${c.folderName || ''} ${c.courseId || ''} ${c.name || ''} ${c.termTag || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderCourseList() {
  const filtered = getFilteredCourses();
  dom.courseSelectionBadge.textContent = `已选 ${state.selectedCourseIds.size} / ${state.courses.length}`;
  dom.courseFilterInfo.textContent =
    filtered.length !== state.courses.length ? `当前显示 ${filtered.length} 门` : '';

  dom.courseListContainer.innerHTML = '';

  if (!state.loggedIn) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      '<p>尚未登录 NTULearn</p><p class="empty-sub">请先点击右上角「打开 NTULearn」完成 SSO 登录，然后回来点击「刷新登录状态」。</p>';
    dom.courseListContainer.appendChild(empty);
    return;
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      state.courses.length === 0
        ? '<p>未找到任何课程</p>'
        : '<p>没有匹配当前搜索或学期条件的课程</p>';
    dom.courseListContainer.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const course of filtered) {
    const checked = state.selectedCourseIds.has(course.id);
    const label = document.createElement('label');
    label.className = `course-card${checked ? ' selected' : ''}`;
    label.setAttribute('role', 'listitem');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.disabled = isBusy();
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.selectedCourseIds.add(course.id);
        label.classList.add('selected');
      } else {
        state.selectedCourseIds.delete(course.id);
        label.classList.remove('selected');
      }
      dom.courseSelectionBadge.textContent = `已选 ${state.selectedCourseIds.size} / ${state.courses.length}`;
      updateActionButtons();
    });

    const body = document.createElement('div');
    body.className = 'course-card-body';

    const top = document.createElement('div');
    top.className = 'course-card-top';

    const codeEl = document.createElement('span');
    codeEl.className = 'course-code';
    codeEl.textContent = course.folderName || course.courseId || course.id;
    top.appendChild(codeEl);

    if (course.termTag) {
      const termEl = document.createElement('span');
      termEl.className = 'course-term-pill';
      termEl.textContent = course.termTag;
      top.appendChild(termEl);
    }

    if (course.available === false) {
      const badge = document.createElement('span');
      badge.className = 'course-unavailable-badge';
      badge.title = '该课程在 NTULearn 上标记为已关闭或不可用，但仍可尝试扫描下载';
      badge.textContent = '已归档/关闭';
      top.appendChild(badge);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'course-name';
    nameEl.textContent = course.name || '(未命名课程)';

    body.appendChild(top);
    body.appendChild(nameEl);
    label.appendChild(cb);
    label.appendChild(body);
    frag.appendChild(label);
  }
  dom.courseListContainer.appendChild(frag);
}

// -------------------- Scanning --------------------

async function handleStartScan() {
  if (isBusy()) return;
  const selectedCourses = state.courses.filter((c) => state.selectedCourseIds.has(c.id));
  if (selectedCourses.length === 0) return;

  state.isScanning = true;
  state.scanAbortController = new AbortController();
  state.scannedCourses.clear();
  state.tasks = [];
  state.selectedTaskKeys.clear();
  state.taskRuntimeStatus.clear();
  state.collapsedGroups.clear();
  state.failedTasks = [];

  resetProgressUI();
  updateActionButtons();
  renderCourseList(); // disable checkboxes while scanning
  renderPreviewTree();
  updateStatsUI();

  const options = readScanOptions();
  addLog(
    `开始扫描 ${selectedCourses.length} 门课程（根目录：${options.rootFolder}，顺序编号：${
      options.useOrderPrefix ? '开' : '关'
    }）...`,
    'info'
  );

  let aborted = false;
  for (let i = 0; i < selectedCourses.length; i++) {
    const course = selectedCourses[i];
    const courseLabel = course.folderName || course.courseId || course.name;
    if (state.scanAbortController.signal.aborted) {
      aborted = true;
      break;
    }

    dom.currentActionStatus.textContent = `正在扫描 (${i + 1}/${selectedCourses.length})：${courseLabel}`;
    addLog(`[${i + 1}/${selectedCourses.length}] 正在扫描课程 ${courseLabel}...`, 'info');

    try {
      const result = await scanCourse(
        course,
        options,
        (progressInfo) => {
          if (typeof progressInfo === 'string') {
            dom.currentActionStatus.textContent = `正在扫描 (${i + 1}/${selectedCourses.length}) ${courseLabel}：${progressInfo}`;
          } else if (progressInfo && typeof progressInfo === 'object') {
            const detail =
              progressInfo.currentTitle ||
              progressInfo.message ||
              progressInfo.currentFolder ||
              (typeof progressInfo.files === 'number' ? `已发现 ${progressInfo.files} 项` : '');
            if (detail) {
              dom.currentActionStatus.textContent = `正在扫描 (${i + 1}/${selectedCourses.length}) ${courseLabel}：${detail}`;
            }
          }
        },
        state.scanAbortController.signal
      );

      const courseTasks = Array.isArray(result && result.tasks) ? result.tasks : [];
      const stats = (result && result.stats) || {
        folders: 0,
        files: 0,
        notes: 0,
        links: 0,
        skippedVideos: 0,
      };
      const errors = Array.isArray(result && result.errors) ? result.errors : [];

      state.scannedCourses.set(course.id, { course, stats, errors });
      for (const task of courseTasks) {
        state.tasks.push(task);
        state.selectedTaskKeys.add(task.key);
      }

      addLog(
        `课程 ${courseLabel} 扫描完成：文件 ${stats.files || 0}，笔记 ${stats.notes || 0}，外链 ${
          stats.links || 0
        }，跳过视频 ${stats.skippedVideos || 0}。`,
        'success'
      );

      for (const errMsg of errors) {
        addLog(`  [扫描警告] ${courseLabel}: ${typeof errMsg === 'string' ? errMsg : errMsg.message || JSON.stringify(errMsg)}`, 'warn');
      }

      updateStatsUI();
      renderPreviewTree();
    } catch (err) {
      if (err && (err.name === 'AbortError' || state.scanAbortController.signal.aborted)) {
        aborted = true;
        addLog('已手动停止扫描。', 'warn');
        break;
      }
      addLog(`扫描课程 ${courseLabel} 失败：${err.message || err}`, 'error');
    }
  }

  state.isScanning = false;
  state.scanAbortController = null;
  dom.currentActionStatus.textContent = aborted
    ? `扫描已停止（已发现 ${state.tasks.length} 项）`
    : `扫描完成，共发现 ${state.tasks.length} 项可下载内容`;

  if (!aborted) {
    addLog(`全部课程扫描完成，共发现 ${state.tasks.length} 个下载任务。`, 'success');
  }

  updateStatsUI();
  renderPreviewTree();
  renderCourseList();
  updateActionButtons();
}

function handleStopScan() {
  if (state.scanAbortController) {
    state.scanAbortController.abort();
    dom.currentActionStatus.textContent = '正在停止扫描...';
  }
}

// -------------------- Stats & Preview Tree --------------------

function computeStats() {
  let courses = state.scannedCourses.size;
  let files = 0;
  let notes = 0;
  let links = 0;
  let skippedVideos = 0;

  for (const entry of state.scannedCourses.values()) {
    const s = entry.stats || {};
    files += s.files || 0;
    notes += s.notes || 0;
    links += s.links || 0;
    skippedVideos += s.skippedVideos || 0;
  }

  // Fallback if tasks exist without stats populated
  if (state.tasks.length > 0 && files + notes + links === 0) {
    for (const t of state.tasks) {
      if (t.type === 'notes') notes++;
      else if (t.type === 'links') links++;
      else files++;
    }
  }

  let willSkip = 0;
  if (state.settings.skipDownloaded) {
    for (const t of state.tasks) {
      if (state.selectedTaskKeys.has(t.key) && state.downloadHistory[t.key]) {
        willSkip++;
      }
    }
  }

  return { courses, files, notes, links, skippedVideos, willSkip };
}

function updateStatsUI() {
  const s = computeStats();
  dom.statCourses.textContent = String(s.courses);
  dom.statFiles.textContent = String(s.files);
  dom.statNotes.textContent = String(s.notes);
  dom.statLinks.textContent = String(s.links);
  dom.statSkippedVideos.textContent = String(s.skippedVideos);
  dom.statWillSkip.textContent = String(s.willSkip);
}

function getFilteredTasks() {
  const q = state.previewSearch.trim().toLowerCase();
  return state.tasks.filter((t) => {
    if (state.previewTypeFilter !== 'all' && t.type !== state.previewTypeFilter) {
      return false;
    }
    if (!q) return true;
    const hay = `${t.relativePath || ''} ${t.fileName || ''} ${t.title || ''} ${t.courseCode || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function getTaskStatusMeta(task) {
  const rt = state.taskRuntimeStatus.get(task.key);
  if (rt) {
    if (rt.status === 'downloading') return { cls: 'task-status-downloading', text: '下载中...' };
    if (rt.status === 'downloaded') return { cls: 'task-status-downloaded', text: '已完成' };
    if (rt.status === 'skipped') return { cls: 'task-status-skipped', text: '已跳过' };
    if (rt.status === 'failed') {
      return {
        cls: 'task-status-failed',
        text: '失败',
        title: rt.error || '下载失败',
      };
    }
  }
  if (state.settings.skipDownloaded && state.downloadHistory[task.key]) {
    return { cls: 'task-status-history', text: '历史已下' };
  }
  return null;
}

function renderTaskStatusPill(el, task) {
  const meta = getTaskStatusMeta(task);
  if (!meta) {
    el.className = 'task-status hidden';
    el.textContent = '';
    el.removeAttribute('title');
    return;
  }
  el.className = `task-status ${meta.cls}`;
  el.textContent = meta.text;
  if (meta.title) {
    el.title = meta.title;
  } else {
    el.removeAttribute('title');
  }
}

function updateSingleTaskRowStatus(task) {
  const row = dom.previewContainer.querySelector(`[data-task-key="${CSS.escape(task.key)}"]`);
  if (!row) return;
  const pill = row.querySelector('.task-status');
  if (pill) renderTaskStatusPill(pill, task);
}

function renderPreviewTree() {
  const totalSelected = state.selectedTaskKeys.size;
  dom.previewCountBadge.textContent = `${totalSelected} 项待下载`;

  const hasTasks = state.tasks.length > 0;
  dom.selectAllTasksBtn.disabled = !hasTasks || isBusy();
  dom.deselectAllTasksBtn.disabled = !hasTasks || isBusy();
  dom.toggleCollapseAllBtn.disabled = !hasTasks;

  if (!hasTasks) {
    dom.previewSelectedHint.textContent = state.isScanning
      ? '正在扫描课程内容，请稍候...'
      : '请先在左侧选择课程并点击「1. 扫描所选课程」';
    dom.previewContainer.innerHTML = state.isScanning
      ? '<div class="empty-state"><p>正在扫描所选课程目录与课件...</p></div>'
      : '<div class="empty-state"><p>尚未扫描课程。</p><p class="empty-sub">在左侧勾选要归档的课程后，点击「1. 扫描所选课程」即可预览完整目录结构与文件清单。</p></div>';
    return;
  }

  const filtered = getFilteredTasks();
  dom.previewSelectedHint.textContent =
    filtered.length === state.tasks.length
      ? `共 ${state.tasks.length} 项，已勾选 ${totalSelected} 项`
      : `筛选显示 ${filtered.length} / ${state.tasks.length} 项，总计已勾选 ${totalSelected} 项`;

  dom.previewContainer.innerHTML = '';

  if (filtered.length === 0) {
    dom.previewContainer.innerHTML =
      '<div class="empty-state"><p>没有匹配当前筛选条件的文件</p></div>';
    return;
  }

  // Group by courseId (or courseCode)
  const groups = new Map();
  for (const task of filtered) {
    const groupId = task.courseId || task.courseCode || 'UNKNOWN';
    if (!groups.has(groupId)) {
      const scannedInfo = state.scannedCourses.get(task.courseId);
      const courseObj = scannedInfo ? scannedInfo.course : null;
      groups.set(groupId, {
        groupId,
        code: (courseObj && (courseObj.folderName || courseObj.courseId)) || task.courseCode || groupId,
        name: (courseObj && courseObj.name) || '',
        tasks: [],
      });
    }
    groups.get(groupId).tasks.push(task);
  }

  const allCollapsed =
    groups.size > 0 && Array.from(groups.keys()).every((id) => state.collapsedGroups.has(id));
  dom.toggleCollapseAllBtn.textContent = allCollapsed ? '展开全部' : '折叠全部';

  const frag = document.createDocumentFragment();
  for (const group of groups.values()) {
    const isCollapsed = state.collapsedGroups.has(group.groupId);
    const groupEl = document.createElement('div');
    groupEl.className = `preview-group${isCollapsed ? ' collapsed' : ''}`;

    const header = document.createElement('div');
    header.className = 'preview-group-header';

    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.textContent = '▼';

    const selectedInGroup = group.tasks.filter((t) => state.selectedTaskKeys.has(t.key)).length;
    const groupCb = document.createElement('input');
    groupCb.type = 'checkbox';
    groupCb.className = 'group-checkbox';
    groupCb.disabled = isBusy();
    groupCb.checked = selectedInGroup === group.tasks.length;
    groupCb.indeterminate = selectedInGroup > 0 && selectedInGroup < group.tasks.length;
    groupCb.addEventListener('click', (e) => e.stopPropagation());
    groupCb.addEventListener('change', () => {
      for (const t of group.tasks) {
        if (groupCb.checked) state.selectedTaskKeys.add(t.key);
        else state.selectedTaskKeys.delete(t.key);
      }
      updateStatsUI();
      updateActionButtons();
      renderPreviewTree();
    });

    const titleEl = document.createElement('span');
    titleEl.className = 'group-title';
    titleEl.textContent = group.code;

    const subEl = document.createElement('span');
    subEl.className = 'group-subtitle';
    subEl.textContent = group.name;
    subEl.title = group.name;

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = `${selectedInGroup} / ${group.tasks.length}`;

    header.appendChild(chevron);
    header.appendChild(groupCb);
    header.appendChild(titleEl);
    header.appendChild(subEl);
    header.appendChild(countEl);

    header.addEventListener('click', () => {
      if (state.collapsedGroups.has(group.groupId)) {
        state.collapsedGroups.delete(group.groupId);
        groupEl.classList.remove('collapsed');
      } else {
        state.collapsedGroups.add(group.groupId);
        groupEl.classList.add('collapsed');
      }
      const nowAllCollapsed = Array.from(groups.keys()).every((id) =>
        state.collapsedGroups.has(id)
      );
      dom.toggleCollapseAllBtn.textContent = nowAllCollapsed ? '展开全部' : '折叠全部';
    });

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'preview-group-items';

    for (const task of group.tasks) {
      const row = document.createElement('label');
      row.className = 'task-row';
      row.dataset.taskKey = task.key;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.selectedTaskKeys.has(task.key);
      cb.disabled = isBusy();
      cb.addEventListener('change', () => {
        if (cb.checked) state.selectedTaskKeys.add(task.key);
        else state.selectedTaskKeys.delete(task.key);
        // Update group counter & checkbox without full re-render
        const sel = group.tasks.filter((t) => state.selectedTaskKeys.has(t.key)).length;
        groupCb.checked = sel === group.tasks.length;
        groupCb.indeterminate = sel > 0 && sel < group.tasks.length;
        countEl.textContent = `${sel} / ${group.tasks.length}`;
        dom.previewCountBadge.textContent = `${state.selectedTaskKeys.size} 项待下载`;
        updateStatsUI();
        updateActionButtons();
      });

      const badge = document.createElement('span');
      const typeInfo =
        task.type === 'notes'
          ? { cls: 'type-notes', label: '笔记' }
          : task.type === 'links'
          ? { cls: 'type-links', label: '外链' }
          : { cls: 'type-file', label: '文件' };
      badge.className = `type-badge ${typeInfo.cls}`;
      badge.textContent = typeInfo.label;

      const pathEl = document.createElement('span');
      pathEl.className = 'task-path';
      pathEl.textContent = task.relativePath || task.fileName || task.title || '(未命名)';
      pathEl.title = task.relativePath || task.fileName || '';

      const statusPill = document.createElement('span');
      renderTaskStatusPill(statusPill, task);

      row.appendChild(cb);
      row.appendChild(badge);
      row.appendChild(pathEl);
      row.appendChild(statusPill);
      itemsWrap.appendChild(row);
    }

    groupEl.appendChild(header);
    groupEl.appendChild(itemsWrap);
    frag.appendChild(groupEl);
  }

  dom.previewContainer.appendChild(frag);
}

// -------------------- Downloading --------------------

function resetProgressUI() {
  updateProgressUI({ total: 0, completed: 0, downloaded: 0, skipped: 0, failed: 0 });
}

function updateProgressUI({ total, completed, downloaded, skipped, failed }) {
  dom.progCompleted.textContent = String(completed || 0);
  dom.progTotal.textContent = String(total || 0);
  dom.progDownloaded.textContent = String(downloaded || 0);
  dom.progSkipped.textContent = String(skipped || 0);
  dom.progFailed.textContent = String(failed || 0);

  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  dom.progPercent.textContent = `${pct}%`;
  dom.progressBarFill.style.width = `${pct}%`;
  dom.progressBarTrack.setAttribute('aria-valuenow', String(pct));
}

async function startDownloadBatch(tasksToRun, { isRetry = false } = {}) {
  if (isBusy() || tasksToRun.length === 0) return;

  state.isDownloading = true;
  state.downloadAbortController = new AbortController();
  if (!isRetry) {
    state.failedTasks = [];
  }

  updateProgressUI({ total: tasksToRun.length, completed: 0, downloaded: 0, skipped: 0, failed: 0 });
  updateActionButtons();
  renderCourseList();
  renderPreviewTree();

  const concurrency = Math.max(1, Number(state.settings.concurrency) || 3);
  const skipDownloaded = isRetry ? false : Boolean(state.settings.skipDownloaded);

  dom.currentActionStatus.textContent = isRetry
    ? `正在重试 ${tasksToRun.length} 个失败项...`
    : `正在下载 ${tasksToRun.length} 个文件（并发 ${concurrency}）...`;

  addLog(
    isRetry
      ? `开始重试 ${tasksToRun.length} 个失败任务...`
      : `开始下载 ${tasksToRun.length} 个任务（并发：${concurrency}，增量跳过：${
          skipDownloaded ? '开' : '关'
        }）...`,
    'info'
  );

  const collectedFailed = [];

  try {
    const summary = await runDownloadQueue(
      tasksToRun,
      {
        concurrency,
        skipDownloaded,
        conflictAction: 'uniquify',
      },
      {
        onItemStart(task) {
          state.taskRuntimeStatus.set(task.key, { status: 'downloading' });
          updateSingleTaskRowStatus(task);
        },
        onItemDone(task, status, errorMsg) {
          const normalized =
            status === 'downloaded' || status === 'success'
              ? 'downloaded'
              : status === 'skipped'
              ? 'skipped'
              : 'failed';
          state.taskRuntimeStatus.set(task.key, {
            status: normalized,
            error: errorMsg || '',
          });
          updateSingleTaskRowStatus(task);

          const label = task.relativePath || task.fileName || task.title;
          if (normalized === 'downloaded') {
            addLog(`✓ 已下载：${label}`, 'success');
          } else if (normalized === 'skipped') {
            addLog(`↷ 已跳过（历史记录）：${label}`, 'info');
          } else {
            collectedFailed.push(task);
            addLog(`✗ 下载失败：${label}${errorMsg ? ` — ${errorMsg}` : ''}`, 'error');
          }
        },
        onProgress(progress) {
          if (progress) {
            updateProgressUI(progress);
            dom.currentActionStatus.textContent = `下载进度：${progress.completed} / ${progress.total}（新下载 ${progress.downloaded}，跳过 ${progress.skipped}，失败 ${progress.failed}）`;
          }
        },
      },
      state.downloadAbortController.signal
    );

    const aborted = state.downloadAbortController.signal.aborted;
    const finalFailed =
      summary && Array.isArray(summary.failedTasks) ? summary.failedTasks : collectedFailed;
    state.failedTasks = finalFailed;

    if (summary) {
      updateProgressUI({
        total: summary.total ?? tasksToRun.length,
        completed: (summary.downloaded || 0) + (summary.skipped || 0) + (summary.failed || 0),
        downloaded: summary.downloaded || 0,
        skipped: summary.skipped || 0,
        failed: summary.failed || 0,
      });
    }

    const msg = aborted
      ? `下载已手动停止：新下载 ${summary?.downloaded || 0}，跳过 ${summary?.skipped || 0}，失败 ${
          summary?.failed || 0
        }。`
      : `下载任务结束：新下载 ${summary?.downloaded || 0}，跳过 ${summary?.skipped || 0}，失败 ${
          summary?.failed || 0
        }。`;
    dom.currentActionStatus.textContent = msg;
    addLog(msg, (summary?.failed || 0) > 0 ? 'warn' : 'success');
  } catch (err) {
    if (err && (err.name === 'AbortError' || state.downloadAbortController.signal.aborted)) {
      state.failedTasks = collectedFailed;
      dom.currentActionStatus.textContent = '下载已手动停止';
      addLog('下载已手动停止。', 'warn');
    } else {
      state.failedTasks = collectedFailed;
      dom.currentActionStatus.textContent = '下载过程中发生异常';
      addLog(`下载队列异常中断：${err.message || err}`, 'error');
    }
  } finally {
    state.isDownloading = false;
    state.downloadAbortController = null;
    await refreshDownloadHistory();
    renderCourseList();
    updateActionButtons();
  }
}

function handleStartDownload() {
  const tasksToRun = state.tasks.filter((t) => state.selectedTaskKeys.has(t.key));
  if (tasksToRun.length === 0) return;
  startDownloadBatch(tasksToRun, { isRetry: false });
}

function handleRetryFailed() {
  if (state.failedTasks.length === 0) return;
  startDownloadBatch([...state.failedTasks], { isRetry: true });
}

function handleStopDownload() {
  if (state.downloadAbortController) {
    state.downloadAbortController.abort();
    dom.currentActionStatus.textContent = '正在停止下载...';
  }
}

// -------------------- Button State Sync --------------------

function updateActionButtons() {
  const busy = isBusy();

  dom.scanBtn.disabled = busy || !state.loggedIn || state.selectedCourseIds.size === 0;
  dom.stopScanBtn.classList.toggle('hidden', !state.isScanning);

  dom.downloadBtn.disabled = busy || state.selectedTaskKeys.size === 0;
  dom.stopDownloadBtn.classList.toggle('hidden', !state.isDownloading);

  const hasFailed = state.failedTasks.length > 0 && !busy;
  dom.retryFailedBtn.classList.toggle('hidden', !hasFailed);
  dom.retryFailedCount.textContent = String(state.failedTasks.length);

  dom.rootFolderInput.disabled = busy;
  dom.concurrencySelect.disabled = busy;
  dom.optOrderPrefix.disabled = busy;
  dom.optSkipDownloaded.disabled = busy;
  dom.optIncludeNotes.disabled = busy;
  dom.optIncludeLinks.disabled = busy;
  dom.optIncludeAssignments.disabled = busy;

  dom.selectAllCoursesBtn.disabled = busy || !state.loggedIn;
  dom.deselectAllCoursesBtn.disabled = busy || !state.loggedIn;
  dom.reloadCoursesBtn.disabled = busy || !state.loggedIn;
  dom.refreshLoginBtn.disabled = busy;

  const historyCount = Object.keys(state.downloadHistory).length;
  dom.clearHistoryBtn.disabled = busy || historyCount === 0;
}

// -------------------- Event Binding --------------------

function bindEvents() {
  dom.openNtulBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: BASE_URL });
  });

  dom.refreshLoginBtn.addEventListener('click', () => {
    refreshLoginAndCourses();
  });

  dom.reloadCoursesBtn.addEventListener('click', () => {
    if (!isBusy() && state.loggedIn) {
      loadCourses();
    }
  });

  dom.dismissTipBtn.addEventListener('click', () => {
    state.settings.tipDismissed = true;
    dom.tipBanner.classList.add('hidden');
    saveSettings();
  });

  dom.rootFolderInput.addEventListener('input', () => {
    state.settings.rootFolder = dom.rootFolderInput.value;
    updatePathPreviewHint();
    saveSettings();
  });

  dom.concurrencySelect.addEventListener('change', () => {
    state.settings.concurrency = Number(dom.concurrencySelect.value) || 3;
    saveSettings();
  });

  dom.optOrderPrefix.addEventListener('change', () => {
    state.settings.useOrderPrefix = dom.optOrderPrefix.checked;
    saveSettings();
  });

  dom.optSkipDownloaded.addEventListener('change', () => {
    state.settings.skipDownloaded = dom.optSkipDownloaded.checked;
    saveSettings();
    updateStatsUI();
    renderPreviewTree();
  });

  dom.optIncludeNotes.addEventListener('change', () => {
    state.settings.includeNotes = dom.optIncludeNotes.checked;
    saveSettings();
  });

  dom.optIncludeLinks.addEventListener('change', () => {
    state.settings.includeLinks = dom.optIncludeLinks.checked;
    saveSettings();
  });

  dom.optIncludeAssignments.addEventListener('change', () => {
    state.settings.includeAssignments = dom.optIncludeAssignments.checked;
    saveSettings();
  });

  dom.clearHistoryBtn.addEventListener('click', handleClearHistory);

  // Course filters
  dom.courseSearchInput.addEventListener('input', () => {
    state.courseSearch = dom.courseSearchInput.value;
    renderCourseList();
  });

  dom.termFilterSelect.addEventListener('change', () => {
    state.selectedTerm = dom.termFilterSelect.value;
    renderCourseList();
  });

  dom.selectAllCoursesBtn.addEventListener('click', () => {
    if (isBusy()) return;
    for (const c of getFilteredCourses()) {
      state.selectedCourseIds.add(c.id);
    }
    renderCourseList();
    updateActionButtons();
  });

  dom.deselectAllCoursesBtn.addEventListener('click', () => {
    if (isBusy()) return;
    for (const c of getFilteredCourses()) {
      state.selectedCourseIds.delete(c.id);
    }
    renderCourseList();
    updateActionButtons();
  });

  // Scan & download buttons
  dom.scanBtn.addEventListener('click', handleStartScan);
  dom.stopScanBtn.addEventListener('click', handleStopScan);
  dom.downloadBtn.addEventListener('click', handleStartDownload);
  dom.stopDownloadBtn.addEventListener('click', handleStopDownload);
  dom.retryFailedBtn.addEventListener('click', handleRetryFailed);

  // Preview filters
  for (const chip of dom.typeFilterChips) {
    chip.addEventListener('click', () => {
      state.previewTypeFilter = chip.dataset.typeFilter || 'all';
      for (const c of dom.typeFilterChips) {
        c.classList.toggle('chip-active', c === chip);
      }
      renderPreviewTree();
    });
  }

  dom.previewSearchInput.addEventListener('input', () => {
    state.previewSearch = dom.previewSearchInput.value;
    renderPreviewTree();
  });

  dom.selectAllTasksBtn.addEventListener('click', () => {
    if (isBusy()) return;
    for (const t of getFilteredTasks()) {
      state.selectedTaskKeys.add(t.key);
    }
    updateStatsUI();
    updateActionButtons();
    renderPreviewTree();
  });

  dom.deselectAllTasksBtn.addEventListener('click', () => {
    if (isBusy()) return;
    for (const t of getFilteredTasks()) {
      state.selectedTaskKeys.delete(t.key);
    }
    updateStatsUI();
    updateActionButtons();
    renderPreviewTree();
  });

  dom.toggleCollapseAllBtn.addEventListener('click', () => {
    const groupIds = new Set(
      getFilteredTasks().map((t) => t.courseId || t.courseCode || 'UNKNOWN')
    );
    const allCollapsed = Array.from(groupIds).every((id) => state.collapsedGroups.has(id));
    if (allCollapsed) {
      state.collapsedGroups.clear();
    } else {
      for (const id of groupIds) state.collapsedGroups.add(id);
    }
    renderPreviewTree();
  });

  dom.clearLogBtn.addEventListener('click', () => {
    dom.logContainer.innerHTML = '';
  });
}

// -------------------- Bootstrap --------------------

async function init() {
  bindEvents();
  await loadSettings();
  await refreshDownloadHistory();
  addLog('NTULearn 课件下载器已就绪。', 'info');
  await refreshLoginAndCourses();
}

init();
