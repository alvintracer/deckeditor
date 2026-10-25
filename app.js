import { collectTextSegments, patchTextSegments } from './editor-core.mjs';
import previewAgent from './preview-agent.js?raw';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const state = {
  folder: null, files: [], path: null, handle: null, html: '', segments: [],
  membership: [], groups: [], groupIndex: 0, selectedId: null, edits: new Map(),
  mode: 'edit', loading: 0, channel: null, validMapping: false,
};
let toastTimer;

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

function send(type, detail = {}) {
  if (state.channel) preview.contentWindow?.postMessage({ deckEditor: state.channel, type, ...detail }, '*');
}

function updateSaveStatus() {
  const count = state.edits.size;
  $('editCount').textContent = `${count}개 수정`;
  const status = $('saveStatus');
  status.classList.toggle('dirty', count > 0);
  status.textContent = !state.path ? 'HTML 파일을 선택하세요' : count ? `${count}개 문장 저장 대기` : '원본과 동일';
  $('saveButton').disabled = !state.handle || !state.validMapping || count === 0;
  $('reloadButton').disabled = !state.handle;
}

function renderFiles() {
  const query = $('fileSearch').value.trim().toLowerCase();
  const list = $('fileList');
  list.replaceChildren();
  const filtered = state.files.filter(({ path }) => path.toLowerCase().includes(query));
  for (const file of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file-item${file.path === state.path ? ' active' : ''}`;
    button.textContent = file.path;
    button.title = file.path;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(file.path === state.path));
    button.addEventListener('click', () => openFile(file));
    list.append(button);
  }
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'line-empty';
    empty.textContent = state.folder ? '이 폴더에 HTML 파일이 없습니다.' : '프로젝트 폴더를 선택하세요.';
    list.append(empty);
  }
}

async function scanFolder(folder, prefix = '', depth = 0) {
  if (depth > 10) return [];
  const result = [];
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind === 'directory') {
      if (!['.git', 'node_modules', 'dist', '.next', '.vercel'].includes(name))
        result.push(...await scanFolder(handle, `${prefix}${name}/`, depth + 1));
    } else if (/\.html?$/i.test(name)) {
      result.push({ path: `${prefix}${name}`, handle });
    }
  }
  return result;
}

async function refreshFiles() {
  if (!state.folder) return;
  try {
    state.files = (await scanFolder(state.folder)).sort((a, b) => a.path.localeCompare(b.path, 'ko'));
    $('rootPath').textContent = `선택한 폴더: ${state.folder.name} · HTML ${state.files.length}개`;
    renderFiles();
  } catch (error) { toast(`폴더를 읽을 수 없습니다: ${error.message}`, true); }
}

function discardChanges() {
  return !state.edits.size || confirm('저장하지 않은 수정이 있습니다. 다른 파일을 열면 수정 내용이 사라집니다. 계속할까요?');
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    toast('이 기능은 최신 Chrome 또는 Edge의 HTTPS 환경에서 사용할 수 있습니다.', true);
    return;
  }
  if (!discardChanges()) return;
  try {
    const folder = await window.showDirectoryPicker({ id: 'deck-editor-project', mode: 'readwrite' });
    state.folder = folder;
    state.path = null;
    state.handle = null;
    state.edits.clear();
    state.validMapping = false;
    state.channel = null;
    $('welcome').hidden = false;
    preview.hidden = true;
    preview.srcdoc = '';
    $('previewTitle').textContent = '미리보기';
    $('previewPath').textContent = 'HTML 파일을 선택하세요';
    $('refreshFiles').disabled = false;
    $('editPanel').hidden = true;
    $('emptyEditor').hidden = false;
    $('lineList').replaceChildren();
    $('lineCount').textContent = '';
    $('slideSelect').replaceChildren(new Option('HTML 파일을 선택하세요', ''));
    $('slideSelect').disabled = true;
    updateSaveStatus();
    await refreshFiles();
    toast(`${folder.name} 폴더를 열었습니다.`);
  } catch (error) {
    if (error.name !== 'AbortError') toast(`폴더 선택에 실패했습니다: ${error.message}`, true);
  }
}

function renderGroupSelect() {
  const select = $('slideSelect');
  select.replaceChildren();
  state.groups.forEach((group, index) => select.add(new Option(group.label, String(index))));
  select.value = String(state.groupIndex);
  select.disabled = state.groups.length <= 1;
  $('slideCount').textContent = state.groups.length > 1 ? `${state.groups.length}장` : '';
}

function textFor(id) {
  return state.edits.get(id) ?? state.segments[id].text;
}

function renderLines() {
  const list = $('lineList');
  list.replaceChildren();
  if (!state.validMapping) return;
  const query = $('lineSearch').value.trim().toLowerCase();
  let count = 0;
  for (const segment of state.segments) {
    const { id } = segment;
    if (state.membership[id] !== state.groupIndex) continue;
    const label = textFor(id).replace(/\s+/g, ' ').trim();
    if (!label || !label.toLowerCase().includes(query)) continue;
    count++;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `line-item${id === state.selectedId ? ' active' : ''}${state.edits.has(id) ? ' changed' : ''}`;
    button.textContent = label.length > 130 ? `${label.slice(0, 130)}…` : label;
    button.title = label;
    button.addEventListener('click', () => selectNode(id, true));
    list.append(button);
  }
  $('lineCount').textContent = `${count}개`;
  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'line-empty';
    empty.textContent = '이 장표에 표시할 문장이 없습니다.';
    list.append(empty);
  }
}

function selectNode(id, scroll = false) {
  if (!state.validMapping || state.membership[id] < 0) return;
  state.selectedId = id;
  state.groupIndex = state.membership[id];
  $('slideSelect').value = String(state.groupIndex);
  $('emptyEditor').hidden = true;
  $('editPanel').hidden = false;
  $('selectedLocation').textContent = `${state.groups[state.groupIndex]?.label || '문서'} · 문장 ${id + 1}`;
  $('textEditor').value = textFor(id);
  $('lengthInfo').textContent = `${$('textEditor').value.length}자`;
  renderLines();
  send('select', { id, scroll });
  $('textEditor').focus();
}

function localAssetPath(ownerPath, reference) {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(reference)) return null;
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) return null;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const piece of clean.split('/')) {
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(decodeURIComponent(piece));
  }
  return parts;
}

async function localFile(ownerPath, reference) {
  try {
    const parts = localAssetPath(ownerPath, reference);
    if (!parts?.length || !state.folder) return null;
    let folder = state.folder;
    for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
    return await (await folder.getFileHandle(parts.at(-1))).getFile();
  } catch { return null; }
}

function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function inlineCssUrls(css, ownerPath) {
  const matches = [...css.matchAll(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi)];
  let result = css;
  for (const match of matches.reverse()) {
    const file = await localFile(ownerPath, match[2].trim());
    if (!file) continue;
    const value = `url("${await dataUrl(file)}")`;
    result = result.slice(0, match.index) + value + result.slice(match.index + match[0].length);
  }
  return result;
}

async function preparePreview(html, filePath) {
  if (!state.folder || !/<(?:img|script|link|source|video|audio)\b[^>]*(?:src|href|poster)\s*=|url\(/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const assets = doc.querySelectorAll('img[src],script[src],source[src],audio[src],video[src],video[poster],link[rel~="stylesheet"][href]');
  for (const element of assets) {
    const attr = element.hasAttribute('src') ? 'src' : element.hasAttribute('poster') ? 'poster' : 'href';
    const reference = element.getAttribute(attr);
    const file = await localFile(filePath, reference);
    if (!file) continue;
    if (element.matches('link[rel~="stylesheet"]')) {
      const style = doc.createElement('style');
      style.textContent = await inlineCssUrls(await file.text(), [...localAssetPath(filePath, reference)].join('/'));
      element.replaceWith(style);
    } else element.setAttribute(attr, await dataUrl(file));
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = await inlineCssUrls(style.textContent, filePath);
  for (const element of doc.querySelectorAll('[style]')) element.setAttribute('style', await inlineCssUrls(element.getAttribute('style'), filePath));
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

function previewHtml(html, channel) {
  const agent = previewAgent.replace('__DECK_EDITOR_CHANNEL__', channel);
  const script = `<script>${agent}</script>`;
  const closeBody = html.toLowerCase().lastIndexOf('</body>');
  return closeBody < 0 ? html + script : html.slice(0, closeBody) + script + html.slice(closeBody);
}

async function readFileText(handle) {
  const bytes = await (await handle.getFile()).arrayBuffer();
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

async function openFile(file, force = false, desiredGroup = 0) {
  if (!force && !discardChanges()) return;
  const token = ++state.loading;
  try {
    const html = await readFileText(file.handle);
    const segments = collectTextSegments(html);
    if (token !== state.loading) return;
    state.path = file.path;
    state.handle = file.handle;
    state.html = html;
    state.segments = segments;
    state.edits.clear();
    state.selectedId = null;
    state.validMapping = false;
    state.groupIndex = desiredGroup;
    state.channel = crypto.randomUUID();
    $('emptyEditor').hidden = false;
    $('editPanel').hidden = true;
    $('previewTitle').textContent = file.path.split('/').at(-1);
    $('previewPath').textContent = file.path;
    $('welcome').hidden = true;
    preview.hidden = false;
    $('lineSearch').disabled = true;
    $('lineList').replaceChildren();
    updateSaveStatus();
    renderFiles();
    const prepared = await preparePreview(html, file.path);
    if (token !== state.loading) return;
    preview.srcdoc = previewHtml(prepared, state.channel);
  } catch (error) { toast(`HTML 파일을 열 수 없습니다: ${error.message}`, true); }
}

window.addEventListener('message', (event) => {
  if (event.source !== preview.contentWindow || event.data?.deckEditor !== state.channel) return;
  const data = event.data;
  if (data.type === 'ready') send('init', { texts: state.segments.map((segment) => segment.text) });
  if (data.type === 'mapped') {
    state.membership = data.membership;
    state.groups = data.groups;
    state.groupIndex = Math.min(state.groupIndex, state.groups.length - 1);
    state.validMapping = true;
    $('lineSearch').disabled = false;
    renderGroupSelect();
    renderLines();
    updateSaveStatus();
    send('mode', { value: state.mode });
    if (state.groupIndex > 0) send('group', { index: state.groupIndex });
    toast(`${data.matched}개 문장을 편집할 수 있습니다.`);
  }
  if (data.type === 'selected') selectNode(data.id);
  if (data.type === 'save') saveFile();
  if (data.type === 'error') {
    state.validMapping = false;
    updateSaveStatus();
    toast(data.message, true);
  }
});

async function saveFile() {
  if (!state.handle || !state.validMapping || !state.edits.size) return;
  $('saveButton').disabled = true;
  try {
    const current = await readFileText(state.handle);
    if (current !== state.html) throw new Error('원본 파일이 다른 프로그램에서 변경됐습니다. 수정 내용을 확인한 뒤 다시 열어주세요.');
    const edits = [...state.edits].map(([id, replacement]) => ({ id, original: state.segments[id].text, replacement }));
    const next = patchTextSegments(current, edits);
    const writable = await state.handle.createWritable();
    try { await writable.write(next); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    const file = { path: state.path, handle: state.handle };
    const group = state.groupIndex;
    await openFile(file, true, group);
    toast(`${edits.length}개 문장을 원본 HTML에 저장했습니다.`);
  } catch (error) {
    toast(`저장하지 못했습니다: ${error.message}`, true);
    updateSaveStatus();
  }
}

function changeText(value) {
  const id = state.selectedId;
  if (id === null) return;
  if (value === state.segments[id].text) state.edits.delete(id);
  else state.edits.set(id, value);
  send('change', { id, value });
  $('lengthInfo').textContent = `${value.length}자`;
  updateSaveStatus();
  renderLines();
}

$('textEditor').addEventListener('input', (event) => changeText(event.target.value));
$('resetText').addEventListener('click', () => {
  if (state.selectedId === null) return;
  const value = state.segments[state.selectedId].text;
  $('textEditor').value = value;
  changeText(value);
});
$('slideSelect').addEventListener('change', (event) => {
  state.groupIndex = Number(event.target.value);
  send('group', { index: state.groupIndex });
  renderLines();
});
$('lineSearch').addEventListener('input', renderLines);
$('fileSearch').addEventListener('input', renderFiles);
$('refreshFiles').addEventListener('click', refreshFiles);
$('chooseFolder').addEventListener('click', chooseFolder);
$('welcomeChooseFolder').addEventListener('click', chooseFolder);
$('reloadButton').addEventListener('click', () => openFile({ path: state.path, handle: state.handle }, false, state.groupIndex));
$('saveButton').addEventListener('click', saveFile);
for (const [id, mode] of [['editMode', 'edit'], ['browseMode', 'browse']]) {
  $(id).addEventListener('click', () => {
    state.mode = mode;
    $('editMode').classList.toggle('active', mode === 'edit');
    $('browseMode').classList.toggle('active', mode === 'browse');
    send('mode', { value: mode });
    toast(mode === 'edit' ? '문장을 클릭해 편집할 수 있습니다.' : '장표의 버튼과 링크를 사용할 수 있습니다.');
  });
}
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveFile();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (state.edits.size) { event.preventDefault(); event.returnValue = ''; }
});
renderFiles();
updateSaveStatus();
