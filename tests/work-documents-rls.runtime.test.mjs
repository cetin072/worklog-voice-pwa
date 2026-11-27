import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, other, parent, child, foreign, doc, unfiled] = [1, 2, 3, 4, 5, 6, 7].map(id);
const paragraphs = '거래처 공급조건과 향후 협의 내용을 기록합니다.\n'.repeat(2000);
const body = `# 장기 사업 기획안\n${paragraphs}\n## 가격 정책\n국내 대리점 최소 주문량\n`;

test('long documents round-trip without truncation, search Korean body, scope folders and deny other accounts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema worklog;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${owner}'), ('${other}');
      create table worklog.work_folders(id uuid primary key, user_id uuid not null, parent_id uuid, unique(id,user_id));
      insert into worklog.work_folders values ('${parent}', '${owner}', null), ('${child}', '${owner}', '${parent}'), ('${foreign}', '${other}', null);
      grant usage on schema auth,worklog to authenticated,anon;
      grant select on worklog.work_folders to authenticated;`);
    await db.exec(fs.readFileSync('supabase/migrations/20261118090000_work_documents.sql', 'utf8'));
    const login = who => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${who}',false)`);
    const save = (user, key, version, title, text, folder) => db.query(
      'select * from worklog.save_my_work_document($1,$2,$3,$4,$5,$6)', [user, key, version, title, text, folder]);
    const list = (user, all, folder, query, offset = 0) => db.query(
      'select * from worklog.list_my_work_documents($1,$2,$3,$4,$5)', [user, all, folder, query, offset]);
    await login(owner);
    const original = await save(owner, doc, -1, ' 천일염 판매 기획안 ', body, child);
    assert.equal(original.rows[0].body, body);
    assert.equal(original.rows[0].title, '천일염 판매 기획안');
    assert.equal((await save(owner, doc, -1, '천일염 판매 기획안', body, child)).rows[0].version, 0);
    assert.equal((await db.query('select body from worklog.work_documents where id=$1', [doc])).rows[0].body, body);
    const found = await list(owner, false, parent, '최소 주문량');
    assert.equal(found.rows[0].id, doc);
    assert.match(found.rows[0].preview, /최소 주문량/);
    assert.ok(found.rows[0].preview.length <= 160);
    assert.equal('body' in found.rows[0], false);
    assert.equal((await list(owner, true, null, '천일염')).rows.length, 1);
    assert.equal((await list(owner, true, null, '%')).rows.length, 0);
    assert.equal((await list(owner, false, null, '')).rows.length, 0);
    await save(owner, unfiled, -1, '보관', '본문', null);
    assert.deepEqual((await list(owner, false, null, '')).rows.map(row => row.id), [unfiled]);
    await assert.rejects(save(owner, doc, 0, '외부 폴더', body, foreign), { code: '23503' });
    await assert.rejects(save(owner, doc, 0, '초과 본문', '가'.repeat(350000), child), { code: '23514' });
    const changed = await save(owner, doc, 0, '편집됨', body, null);
    assert.equal(changed.rows[0].version, 1);
    assert.equal((await save(owner, doc, 0, '편집됨', body, null)).rows[0].version, 1);
    await assert.rejects(save(owner, doc, 0, '오래된 편집', body, child), { code: 'PT409' });
    await login(other);
    assert.equal((await list(other, true, null, '최소 주문량')).rows.length, 0);
    assert.equal((await list(owner, true, null, '')).rows.length, 0);
    assert.equal((await db.query('select body from worklog.work_documents where id=$1', [doc])).rows.length, 0);
    await assert.rejects(save(other, doc, 1, '변경', '다른 계정', null), { code: 'PT409' });
    await assert.rejects(save(owner, doc, 1, '변경', '다른 계정', null), { code: '42501' });
    await db.exec('reset role; set role anon');
    await assert.rejects(list(owner, true, null, ''), { code: '42501' });

    // Upgrade an existing database without changing older list, read, or save clients.
    await db.exec('reset role');
    await db.exec(fs.readFileSync('supabase/migrations/20261128000500_work_document_trash.sql', 'utf8'));
    const trash = (who, key, version, deleted) => db.query(
      'select worklog.set_my_work_document_deleted($1,$2,$3,$4) as version', [who, key, version, deleted]);
    await db.exec('set role anon');
    await assert.rejects(trash(owner, doc, 1, true), { code: '42501' });
    await login(other);
    await assert.rejects(trash(owner, doc, 1, true), { code: '42501' });
    await assert.rejects(trash(other, doc, 1, true), { code: 'PT409' });
    await login(owner);
    await assert.rejects(trash(owner, doc, 0, true), { code: 'PT409' });
    assert.equal((await list(owner, true, null, '최소 주문량')).rows.length, 1);
    await assert.rejects(db.query('update worklog.work_documents set deleted_at = now() where id=$1', [doc]), { code: '42501' });
    await assert.rejects(db.query('delete from worklog.work_documents where id=$1', [doc]), { code: '42501' });
    assert.equal((await trash(owner, doc, 1, true)).rows[0].version, 2);
    assert.equal((await trash(owner, doc, 1, true)).rows[0].version, 2);
    assert.equal((await list(owner, true, null, '최소 주문량')).rows.length, 0);
    assert.equal((await db.query('select * from worklog.work_documents where id=$1', [doc])).rows.length, 0);
    await assert.rejects(save(owner, doc, 1, '오래된 저장', body, child), { code: 'PT409' });
    await login(other);
    await assert.rejects(trash(other, doc, 2, false), { code: 'PT409' });
    await login(owner);
    assert.equal((await trash(owner, doc, 2, false)).rows[0].version, 3);
    assert.equal((await trash(owner, doc, 2, false)).rows[0].version, 3);
    assert.deepEqual((await db.query('select title,body from worklog.work_documents where id=$1', [doc])).rows, [{ title: '편집됨', body }]);
  } finally {
    await db.close();
  }
});
