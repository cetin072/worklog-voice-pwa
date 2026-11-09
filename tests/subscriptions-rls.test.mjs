import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { afterEach } from 'node:test';
const opened = [];
afterEach(async () => { for (const db of opened.splice(0)) await db.close(); });
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync('supabase/migrations/20261109120000_subscriptions_v1.sql', 'utf8');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

// Supabase 환경을 흉내 낸 최소 부트스트랩: auth.uid(), auth.users, anon/authenticated 역할.
async function freshDb() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema worklog;
    grant usage on schema worklog to authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${USER_A}'), ('${USER_B}');
  `);
  await db.exec(migration);
  await db.exec(fs.readFileSync('supabase/migrations/20261109144344_subscriptions_payment_method.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261109232907_regular_expenses_v1.sql', 'utf8'));
  return db;
}

async function asUser(db, userId, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role;'); }
}

const insertSql = `insert into worklog.subscriptions (name, amount_krw, billing_cycle, scope, billing_anchor_date)
  values ($1, $2, $3, $4, '2026-11-15') returning id, user_id`;

test('user_id는 로그인한 사용자로 자동 지정되고 본인 행만 조회된다', async () => {
  const db = await freshDb();
  const a = await asUser(db, USER_A, insertSql, ['클라우드', 12000, 'monthly', 'business']);
  assert.equal(a.rows[0].user_id, USER_A);
  await asUser(db, USER_B, insertSql, ['영상 구독', 9900, 'monthly', 'personal']);
  const seenByA = await asUser(db, USER_A, 'select name from worklog.subscriptions');
  const seenByB = await asUser(db, USER_B, 'select name from worklog.subscriptions');
  assert.deepEqual(seenByA.rows.map((r) => r.name), ['클라우드']);
  assert.deepEqual(seenByB.rows.map((r) => r.name), ['영상 구독']);
});

test('다른 사용자 명의로 추가하거나 남의 행을 수정할 수 없다', async () => {
  const db = await freshDb();
  const a = await asUser(db, USER_A, insertSql, ['클라우드', 12000, 'monthly', 'business']);
  await assert.rejects(
    asUser(db, USER_B, `insert into worklog.subscriptions (user_id, name, amount_krw, billing_cycle, scope, billing_anchor_date)
      values ('${USER_A}', '위장', 1000, 'monthly', 'personal', '2026-11-15')`),
    /row-level security/i,
  );
  const updated = await asUser(db, USER_B, `update worklog.subscriptions set last_used_date = '2026-11-09' where id = $1 returning id`, [a.rows[0].id]);
  assert.equal(updated.rows.length, 0, '남의 행은 0건 갱신');
  // 소유자 변경(행 가로채기)도 막혀야 한다
  await assert.rejects(
    asUser(db, USER_A, `update worklog.subscriptions set user_id = '${USER_B}' where id = $1`, [a.rows[0].id]),
    /row-level security/i,
  );
});

test('하드 DELETE는 막혀 있고 보관(archived_at)만 가능하다', async () => {
  const db = await freshDb();
  const a = await asUser(db, USER_A, insertSql, ['클라우드', 12000, 'monthly', 'business']);
  await assert.rejects(asUser(db, USER_A, 'delete from worklog.subscriptions where id = $1', [a.rows[0].id]), /permission denied/i);
  const archived = await asUser(db, USER_A, 'update worklog.subscriptions set archived_at = now() where id = $1 returning id', [a.rows[0].id]);
  assert.equal(archived.rows.length, 1);
  const active = await asUser(db, USER_A, 'select id from worklog.subscriptions where archived_at is null');
  assert.equal(active.rows.length, 0);
});

test('비로그인(anon)은 아무것도 읽거나 쓸 수 없다', async () => {
  const db = await freshDb();
  await asUser(db, USER_A, insertSql, ['클라우드', 12000, 'monthly', 'business']);
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  await assert.rejects(db.query('select * from worklog.subscriptions'), /permission denied/i);
  await assert.rejects(db.query(`insert into worklog.subscriptions (name, amount_krw, billing_cycle, scope, billing_anchor_date) values ('x', 1, 'monthly', 'personal', '2026-11-15')`), /permission denied/i);
  await db.exec('reset role;');
});

test('잘못된 값은 DB 제약이 거부한다(금액·주기·구분·이름)', async () => {
  const db = await freshDb();
  for (const [name, amount, cycle, scope] of [
    ['x', 0, 'monthly', 'business'],
    ['x', -5, 'monthly', 'business'],
    ['x', 100000001, 'monthly', 'business'],
    ['x', 1000, 'weekly', 'business'],
    ['x', 1000, 'monthly', 'team'],
    ['   ', 1000, 'monthly', 'business'],
    ['a'.repeat(61), 1000, 'monthly', 'business'],
  ]) {
    await assert.rejects(asUser(db, USER_A, insertSql, [name, amount, cycle, scope]), /violates check constraint/i, `${name.slice(0, 5)}/${amount}/${cycle}/${scope}`);
  }
});

test('계정이 삭제되면 그 사용자의 구독도 함께 지워진다', async () => {
  const db = await freshDb();
  await asUser(db, USER_A, insertSql, ['클라우드', 12000, 'monthly', 'business']);
  await db.exec(`delete from auth.users where id = '${USER_A}'`);
  assert.equal((await db.query('select count(*)::int as n from worklog.subscriptions')).rows[0].n, 0);
});

test('원문(source_text)은 300자까지 저장되고 그보다 길면 거부된다', async () => {
  const db = await freshDb();
  const insertWithSource = `insert into worklog.subscriptions (name, amount_krw, billing_cycle, scope, billing_anchor_date, source_text)
    values ('x', 1000, 'monthly', 'personal', '2026-11-15', $1) returning source_text`;
  const ok = await asUser(db, USER_A, insertWithSource, ['사업 클라우드 매달 1만원 15일']);
  assert.equal(ok.rows[0].source_text, '사업 클라우드 매달 1만원 15일');
  await asUser(db, USER_A, insertWithSource, ['가'.repeat(300)]);
  await assert.rejects(asUser(db, USER_A, insertWithSource, ['가'.repeat(301)]), /violates check constraint/i);
  const none = await asUser(db, USER_A, insertSql, ['직접 입력', 1000, 'monthly', 'personal']);
  assert.equal(none.rows.length, 1, '직접 입력은 원문 없이 저장');
});


test('선택 결제수단을 본인 구독에 기록하고 이전 행은 null로 보존한다', async () => {
 const db = await freshDb();
 const a = await asUser(db, USER_A, insertSql, ['합성 구독', 12000, 'monthly', 'business']);
 const id=a.rows[0].id;
 const initial=await asUser(db,USER_A,'select payment_method,payment_name from worklog.subscriptions where id=$1',[id]);
 assert.deepEqual(initial.rows,[{payment_method:null,payment_name:null}]);
 await asUser(db,USER_A,"update worklog.subscriptions set payment_method='card',payment_name='삼성카드 · 업무용' where id=$1",[id]);
 const mine=await asUser(db,USER_A,'select payment_method,payment_name from worklog.subscriptions where id=$1',[id]);
 assert.equal(mine.rows[0].payment_name,'삼성카드 · 업무용');
 const theirs=await asUser(db,USER_B,'select payment_name from worklog.subscriptions where id=$1',[id]);assert.equal(theirs.rows.length,0);
 const changed=await asUser(db,USER_B,"update worklog.subscriptions set payment_name='가로채기' where id=$1 returning id",[id]);assert.equal(changed.rows.length,0);
 await assert.rejects(asUser(db,USER_A,"update worklog.subscriptions set payment_method='invalid' where id=$1",[id]),/check constraint/);
 await assert.rejects(asUser(db,USER_A,"update worklog.subscriptions set payment_name=repeat('가',61) where id=$1",[id]),/check constraint/);
 await assert.rejects(asUser(db,USER_A,'update worklog.subscriptions set payment_method=null where id=$1',[id]),/check constraint/);
});


test('납부 회차 중복 방지·본인 격리·종료 후 이력 보존·임의 회차 거부', async () => {
  const db = await freshDb();
  try {
    const a = await asUser(db, USER_A, insertSql, ['보험', 120000, 'monthly', 'personal']);
    const id = a.rows[0].id;
    const paid = () => asUser(db, USER_A, 'select worklog.confirm_subscription_payment($1,$2) receipt', [id, '2026-11-15']);
    const first = await paid();
    for (let i = 0; i < 10; i++) assert.deepEqual((await paid()).rows, first.rows);
    assert.equal((await asUser(db, USER_A, 'select * from worklog.subscription_payments')).rows.length, 1);
    assert.equal((await asUser(db, USER_B, 'select * from worklog.subscription_payments')).rows.length, 0);
    await assert.rejects(asUser(db, USER_B, 'select worklog.confirm_subscription_payment($1,$2)', [id,'2026-11-15']), /EXPENSE_NOT_AVAILABLE/);
    await assert.rejects(asUser(db, USER_A, 'select worklog.confirm_subscription_payment($1,$2)', [id,'2026-11-16']), /row-level security/);
    await asUser(db, USER_A, 'update worklog.subscriptions set archived_at = now() where id = $1', [id]);
    assert.deepEqual((await paid()).rows, first.rows);
    await assert.rejects(asUser(db, USER_A, 'select worklog.confirm_subscription_payment($1,$2)', [id,'2026-12-15']), /EXPENSE_NOT_AVAILABLE/);
    await assert.rejects(asUser(db, USER_A, 'delete from worklog.subscription_payments'), /permission denied/);
  } finally { /* afterEach closes the isolated database. */ }
});
