import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';
import { documentSections } from '../mobile/src/features/work/work-document-markdown.ts';

test('document editor imports a long file, retains it after save failure, then opens, jumps and searches', async () => {
  const text = '# 사업 계획\n' + '공급 조건을 기록합니다.\n'.repeat(3000) + '## 가격 정책\n최소 주문량';
  let current, trashed, attempts = 0, deletionAttempts = 0, scroll;
  const queries = [];
  const mock = {
    DOCUMENT_MAX_BYTES: 1048576,
    listDocuments: async (_client, owner, scope, query) => {
      queries.push({ owner, scope, query });
      return { rows: current ? [{ ...current, preview: '최소 주문량' }] : [], more: false };
    },
    readDocument: async () => current,
    setDocumentDeleted: async (_client, owner, document, deleted) => {
      assert.equal(owner, 'owner');
      if (deleted) {
        assert.equal(document.version, current.version);
        if (++deletionAttempts === 1) throw Error('삭제를 확인하지 못했습니다.');
        trashed = { ...current, version: current.version + 1 };
        current = null;
        return trashed.version;
      }
      assert.equal(document.version, trashed.version);
      current = { ...trashed, version: trashed.version + 1 };
      return current.version;
    },
    saveDocument: async (_client, owner, draft) => {
      assert.equal(owner, 'owner');
      assert.equal(draft.body, text);
      assert.equal(draft.folder_id, 'project');
      assert.equal(draft.id, 'document');
      if (++attempts === 1) throw Error('일시적인 저장 오류');
      current = { ...draft, version: 0 };
      return current;
    },
  };
  const h = nativeComponentHarness('mobile/src/features/work/work-documents.tsx', 'WorkDocuments', {
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-crypto': { randomUUID: () => 'document' },
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: false, assets: [{ name: '긴 기획안.md', uri: 'file:///test.md' }] }) },
    'expo-file-system': { File: class { async text() { return text; } } },
    '@/src/ui/theme': { mobileTheme: { colors: {} } },
    './work-folders-store': { folderPath: (_folders, id) => id ? '기획' : '미분류' },
    './work-document-markdown': { documentSections },
    './work-documents-store': mock,
  });
  const props = { client: {}, owner: 'owner', scope: 'project', folders: [{ id: 'project', name: '기획' }], revision: '0' };
  const expand = node => Array.isArray(node) ? node.map(expand)
    : node && typeof node === 'object' ? typeof node.type === 'function' ? expand(node.type(node.props))
    : { ...node, props: { ...node.props, children: expand(node.props.children) } } : node;
  const render = () => expand(h.render(props));
  const button = label => nativeNodes(render()).find(n => n.type === 'Pressable' && nativeWords(n).trim() === label);
  const input = label => nativeNodes(render()).find(n => n.props?.accessibilityLabel === label);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    render();
    await h.effects();
    button('새 문서').props.onPress();
    button('파일 가져오기').props.onPress();
    await tick();
    assert.equal(input('문서 제목').props.value, '긴 기획안');
    assert.equal(input('문서 본문').props.value, text);
    button('저장').props.onPress();
    await tick();
    assert.match(nativeWords(render()), /일시적인 저장 오류/);
    assert.equal(input('문서 본문').props.value, text);
    button('저장').props.onPress();
    await tick();
    let tree = render();
    await h.effects();
    assert.match(nativeWords(tree), /목차/);
    nativeNodes(tree).find(n => n.type === 'ScrollView').props.ref.current = { scrollTo: value => { scroll = value; } };
    nativeNodes(tree).filter(n => n.props?.onLayout).at(-1).props.onLayout({ nativeEvent: { layout: { y: 48000 } } });
    button('가격 정책').props.onPress();
    assert.deepEqual(scroll, { y: 48000, animated: true });
    button('닫기').props.onPress();
    input('문서 제목 또는 본문 검색').props.onChangeText('최소 주문량');
    button('검색').props.onPress();
    render();
    await h.effects();
    assert.deepEqual(queries.at(-1), { owner: 'owner', scope: 'project', query: '최소 주문량' });
    nativeNodes(render()).find(n => n.type === 'Pressable' && nativeWords(n).includes('긴 기획안')).props.onPress();
    await tick();
    assert.match(nativeWords(render()), /목차/);
    button('편집').props.onPress();
    assert.equal(input('문서 본문').props.value, text);
    button('닫기').props.onPress();
    const deleteFromList = () => input('긴 기획안 문서 삭제').props.onPress();
    deleteFromList();
    await tick();
    assert.match(nativeWords(render()), /이 문서를 삭제할까요/);
    button('취소').props.onPress();
    assert.equal(deletionAttempts, 0);
    input('긴 기획안 문서 열기').props.onPress();
    await tick();
    assert.ok(nativeNodes(render()).find(n => n.type === 'Modal' && nativeWords(n).includes('삭제')));
    const readerDelete = nativeNodes(render()).filter(n => n.type === 'Pressable' && nativeWords(n).trim() === '삭제').at(-1);
    readerDelete.props.onPress();
    button('취소').props.onPress();
    assert.match(nativeWords(render()), /목차/);
    button('닫기').props.onPress();
    deleteFromList();
    await tick();
    button('문서 삭제').props.onPress();
    await tick();
    assert.match(nativeWords(render()), /삭제를 확인하지 못했습니다/);
    assert.ok(current);
    const confirm = button('문서 삭제').props.onPress;
    confirm();
    confirm();
    await tick();
    render();
    await h.effects();
    assert.equal(deletionAttempts, 2);
    assert.equal(input('긴 기획안 문서 열기'), undefined);
    input('긴 기획안 삭제 실행 취소').props.onPress();
    await tick();
    render();
    await h.effects();
    assert.ok(input('긴 기획안 문서 열기'));
    assert.equal(current.body, text);
  } finally {
    h.close();
  }
});
