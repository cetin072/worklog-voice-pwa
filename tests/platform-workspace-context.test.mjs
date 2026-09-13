import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_ROLES,
  createUnconfiguredWorkspaceContextProvider,
  normalizeWorkspaceContext,
  requireWorkspaceContext,
} from "../netlify/shared/platform/workspace-context.mjs";

test("Workspace Context는 owner/member 역할만 공개한다", () => {
  assert.deepEqual([...WORKSPACE_ROLES], ["owner", "member"]);
});

test("Workspace Context는 camelCase 입력을 정규화한다", () => {
  const context = normalizeWorkspaceContext({
    userId: " user-1 ",
    workspaceId: " workspace-1 ",
    role: "OWNER",
  });

  assert.deepEqual(context, {
    userId: "user-1",
    workspaceId: "workspace-1",
    role: "owner",
  });
  assert.equal(Object.isFrozen(context), true);
});

test("Workspace Context는 snake_case 경계 입력도 내부 표준으로 정규화한다", () => {
  assert.deepEqual(
    normalizeWorkspaceContext({
      user_id: "user-2",
      workspace_id: "workspace-2",
      role: "member",
    }),
    {
      userId: "user-2",
      workspaceId: "workspace-2",
      role: "member",
    },
  );
});

test("requireWorkspaceContext는 workspaceContext wrapper를 지원한다", () => {
  assert.deepEqual(
    requireWorkspaceContext({
      workspaceContext: {
        userId: "user-3",
        workspaceId: "workspace-3",
        role: "member",
      },
    }),
    {
      userId: "user-3",
      workspaceId: "workspace-3",
      role: "member",
    },
  );
});

test("Workspace Context는 userId 누락을 차단한다", () => {
  assert.throws(
    () => normalizeWorkspaceContext({ workspaceId: "workspace-1", role: "owner" }),
    (error) => error?.code === "WORKSPACE_CONTEXT_USER_REQUIRED",
  );
});

test("Workspace Context는 workspaceId 누락을 차단한다", () => {
  assert.throws(
    () => normalizeWorkspaceContext({ userId: "user-1", role: "owner" }),
    (error) => error?.code === "WORKSPACE_CONTEXT_WORKSPACE_REQUIRED",
  );
});

test("Workspace Context는 허용되지 않은 role을 차단한다", () => {
  assert.throws(
    () => normalizeWorkspaceContext({ userId: "user-1", workspaceId: "workspace-1", role: "admin" }),
    (error) => error?.code === "WORKSPACE_CONTEXT_ROLE_INVALID",
  );
});

test("미연결 Workspace Context provider는 명시적으로 잠긴다", async () => {
  const provider = createUnconfiguredWorkspaceContextProvider();
  assert.equal(provider.configured, false);
  await assert.rejects(
    () => provider.getCurrent(),
    (error) => error?.code === "WORKSPACE_CONTEXT_NOT_CONFIGURED",
  );
});
