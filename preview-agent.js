(() => {
  const channel = '__DECK_EDITOR_CHANNEL__';
  let nodes = [];
  let nodeIds = new WeakMap();
  let groups = [];
  let mode = 'edit';

  function send(type, detail = {}) {
    parent.postMessage({ deckEditor: channel, type, ...detail }, '*');
  }

  function eligibleNodes() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue.trim()) continue;
      if (node.parentElement?.closest('script,style,svg.ey,noscript,textarea,option,template')) continue;
      result.push(node);
    }
    return result;
  }

  function align(source, candidates) {
    const mapped = new Array(source.length).fill(null);
    let i = 0;
    let j = 0;
    let matched = 0;
    while (i < source.length && j < candidates.length) {
      if (source[i] === candidates[j].nodeValue) {
        mapped[i++] = candidates[j++];
        matched++;
        continue;
      }
      let skip = null;
      for (let distance = 1; distance <= 12 && !skip; distance++) {
        for (let sourceSkip = 0; sourceSkip <= distance; sourceSkip++) {
          const shownSkip = distance - sourceSkip;
          if (source[i + sourceSkip] === candidates[j + shownSkip]?.nodeValue) {
            skip = { sourceSkip, shownSkip };
            break;
          }
        }
      }
      if (!skip) throw new Error(`${i + 1}번째 문장을 화면과 연결할 수 없습니다. 장표 스크립트가 문장 순서를 바꿨을 수 있습니다.`);
      i += skip.sourceSkip;
      j += skip.shownSkip;
    }
    if (matched < Math.min(source.length, 5)) throw new Error('원본 문장과 화면의 문장을 연결할 수 없습니다.');
    return { mapped, matched };
  }

  function makeGroups() {
    let elements = [...document.querySelectorAll('.sheet')];
    if (!elements.length) elements = [...document.querySelectorAll('article.slide,section.slide')];
    if (!elements.length) elements = [document.body];
    return elements.map((element, index) => {
      const heading = element.querySelector('h1,h2')?.textContent.trim();
      const number = element.getAttribute('data-page') || String(index + 1).padStart(2, '0');
      return { element, label: elements.length === 1 ? '전체 문서' : `${number} · ${heading || '장표'}` };
    });
  }

  function nearestId(event) {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
      const id = nodeIds.get(range.startContainer);
      if (id !== undefined) return id;
    }
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return null;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const id = nodeIds.get(walker.currentNode);
      if (id !== undefined) return id;
    }
    return null;
  }

  function select(id, scroll) {
    document.querySelectorAll('[data-deck-editor-active]').forEach((element) => element.removeAttribute('data-deck-editor-active'));
    const node = nodes[id];
    if (!node) return;
    node.parentElement?.setAttribute('data-deck-editor-active', '');
    if (scroll) node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function init(texts) {
    const result = align(texts, eligibleNodes());
    nodes = result.mapped;
    nodeIds = new WeakMap();
    nodes.forEach((node, id) => { if (node) nodeIds.set(node, id); });
    groups = makeGroups();
    const membership = nodes.map((node) => node ? groups.findIndex((group) => group.element.contains(node)) : -1);
    const style = document.createElement('style');
    style.textContent = '[data-deck-editor-active]{outline:2px solid #ff9e18!important;outline-offset:2px!important;background-color:#fff5d2a8!important} html.deck-editor-edit-mode.deck-editor-deck .toolbar,html.deck-editor-edit-mode.deck-editor-deck .status,html.deck-editor-edit-mode.deck-editor-deck .toc,html.deck-editor-edit-mode.deck-editor-deck .notes,html.deck-editor-edit-mode.deck-editor-deck .scrim,html.deck-editor-edit-mode.deck-editor-deck .toast{display:none!important}';
    document.head.append(style);
    if (document.querySelector('.deck .sheet')) document.documentElement.classList.add('deck-editor-deck');
    document.documentElement.classList.toggle('deck-editor-edit-mode', mode === 'edit');
    send('mapped', { matched: result.matched, groups: groups.map(({ label }) => ({ label })), membership });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.deckEditor !== channel) return;
    const { type, id, value, index } = event.data;
    try {
      if (type === 'init') init(event.data.texts);
      if (type === 'select') select(id, event.data.scroll);
      if (type === 'change' && nodes[id]) nodes[id].nodeValue = value;
      if (type === 'group') groups[index]?.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (type === 'mode') {
        mode = value;
        document.documentElement.classList.toggle('deck-editor-edit-mode', mode === 'edit');
      }
    } catch (error) { send('error', { message: error.message }); }
  });

  document.addEventListener('click', (event) => {
    if (mode !== 'edit') return;
    const id = nearestId(event);
    if (id === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    select(id, false);
    send('selected', { id });
  }, true);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      send('save');
    }
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => send('ready'), { once: true });
  else send('ready');
})();
