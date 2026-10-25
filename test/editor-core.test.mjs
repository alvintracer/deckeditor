import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTextSegments, patchTextSegments } from '../editor-core.mjs';

test('수정한 텍스트만 바꾸고 HTML과 스타일은 그대로 보존한다', () => {
  const html = '<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>원래 제목</h1><p>안내 &amp; 설명 <b>강조</b> 끝</p></body></html>';
  const segments = collectTextSegments(html);
  assert.deepEqual(segments.map((segment) => segment.text), ['원래 제목', '안내 & 설명 ', '강조', ' 끝']);
  const edited = patchTextSegments(html, [
    { id: 0, original: '원래 제목', replacement: '새 제목 <검토>' },
    { id: 1, original: '안내 & 설명 ', replacement: '안내 & 확인 ' },
  ]);
  assert.equal(edited, html.replace('원래 제목', '새 제목 &lt;검토&gt;').replace('안내 &amp; 설명 ', '안내 &amp; 확인 '));
});

test('오래된 문장이나 중복 ID는 저장하지 않는다', () => {
  const html = '<html><body><p>첫째</p><p>둘째</p></body></html>';
  assert.throws(() => patchTextSegments(html, [{ id: 0, original: '다른 문장', replacement: '수정' }]));
  assert.throws(() => patchTextSegments(html, [
    { id: 0, original: '첫째', replacement: '수정' },
    { id: 0, original: '첫째', replacement: '중복' },
  ]));
});
