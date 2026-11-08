import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { withRequestDeadline } = await import('../mobile/src/platform/request-deadline.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const apiAst = ts.createSourceFile('api.ts', readFileSync('mobile/src/platform/worklog-api.ts','utf8'), ts.ScriptTarget.Latest, true);
const homeAst = ts.createSourceFile('home.tsx', readFileSync('mobile/app/index.tsx','utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(ast, name) {
  let found;
  function walk(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast); ts.forEachChild(node,walk); }
  walk(ast); assert.ok(found); return found;
}
function compile(code, scope) {
  const js = ts.transpileModule(code,{ compilerOptions:{module:ts.ModuleKind.CommonJS} }).outputText;
  return new Function('scope','with(scope) {'+js+'}')(scope);
}

test('real journal loader aborts a stalled read through the existing deadline', async () => {
  let aborted = false, url = '';
  const scope = {
    withRequestDeadline: fn => withRequestDeadline(fn, 20),
    getApiBaseUrl: () => 'https://test.invalid',
    fetch: (input, opts) => { url = input; opts.signal.addEventListener('abort',()=>{aborted=true;}); return new Promise(()=>{}); },
  };
  const load = compile(declaration(apiAst,'loadWorkJournalDay')+'\nreturn loadWorkJournalDay;',scope);
  await assert.rejects(load('synthetic-token','2030-01-05'), /연결이 지연되고/);
  assert.equal(aborted,true); assert.match(url,/work-journal\?date=2030-01-05/);
});

test('journal reads with fresh auth token and ignores an old date response after its effect cleanup', async () => {
  let effectSource = '';
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(homeAst)==='useEffect' &&
        node.arguments[0]?.getText(homeAst).includes('loadHomeJournal(token, journalDate)')) effectSource=node.arguments[0].getText(homeAst);
    ts.forEachChild(node,walk);
  }
  walk(homeAst); assert.ok(effectSource);
  const state={rows:[],error:[],busy:[]}, pending=[];
  const scope={ session:{user:{id:'owner'},access_token:'old'}, client:{}, screen:'journal', journalDate:'2030-01-04',
    freshHomeAccessToken: async()=> 'fresh',
    loadHomeJournal:(token,date)=>new Promise(resolve=>pending.push({token,date,resolve})),
    setJournal:v=>state.rows.push(v), setJournalBusy:v=>state.busy.push(v), setJournalError:v=>state.error.push(v),
    messageOf:(e)=> e.message,
  };
  const effect=compile('return ('+effectSource+');',scope);
  const cancelOld=effect();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual([pending[0].token,pending[0].date],['fresh','2030-01-04']);
  cancelOld();
  scope.journalDate='2030-01-05';
  const cancelNew=effect();
  await Promise.resolve(); await Promise.resolve();
  pending[0].resolve({targetDate:'2030-01-04'});
  pending[1].resolve({targetDate:'2030-01-05'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(state.rows.filter(Boolean).map(x=>x.targetDate),['2030-01-05']);
  assert.equal(state.busy.at(-1),false);
  cancelNew();
});
