import { parse } from 'parse5';

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'option', 'template']);

export function collectTextSegments(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const body = findBody(document);
  const segments = [];

  function walk(node, skip = false) {
    const tag = node.tagName?.toLowerCase();
    const isLogo = tag === 'svg' && node.attrs?.some((attr) => attr.name === 'class' && attr.value.split(/\s+/).includes('ey'));
    const excluded = skip || SKIP_TAGS.has(tag) || isLogo;
    if (node.nodeName === '#text' && !excluded && node.value.trim()) {
      const location = node.sourceCodeLocation;
      if (location) segments.push({ id: segments.length, text: node.value, start: location.startOffset, end: location.endOffset });
    }
    for (const child of node.childNodes || []) walk(child, excluded);
  }

  if (body) walk(body);
  return segments;
}

function findBody(node) {
  if (node.tagName === 'body') return node;
  for (const child of node.childNodes || []) {
    const found = findBody(child);
    if (found) return found;
  }
  return null;
}

function escapeHtmlText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function patchTextSegments(html, edits) {
  if (!Array.isArray(edits)) throw new Error('수정 목록 형식이 올바르지 않습니다.');
  const segments = collectTextSegments(html);
  const ids = new Set();
  const patches = edits.map((edit) => {
    const segment = segments[edit.id];
    if (!Number.isInteger(edit.id) || !segment || ids.has(edit.id))
      throw new Error('수정 대상이 현재 파일과 일치하지 않습니다.');
    ids.add(edit.id);
    if (typeof edit.original !== 'string' || typeof edit.replacement !== 'string')
      throw new Error('수정할 문장의 형식이 올바르지 않습니다.');
    if (segment.text !== edit.original)
      throw new Error('원본 문장이 변경됐습니다. 파일을 다시 열어주세요.');
    return { ...segment, replacement: escapeHtmlText(edit.replacement) };
  });

  let result = html;
  for (const patch of patches.sort((a, b) => b.start - a.start))
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end);
  return result;
}
