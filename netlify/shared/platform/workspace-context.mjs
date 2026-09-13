export const WORKSPACE_ROLES = Object.freeze(["owner", "member"]);

function text(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function workspaceContextError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normalizeWorkspaceContext(raw = {}) {
  const userId = text(raw.userId ?? raw.user_id);
  const workspaceId = text(raw.workspaceId ?? raw.workspace_id);
  const role = text(raw.role, 40).toLowerCase();

  if (!userId) {
    throw workspaceContextError(
      "WORKSPACE_CONTEXT_USER_REQUIRED",
      "Workspace Context에는 userId가 필요합니다.",
    );
  }

  if (!workspaceId) {
    throw workspaceContextError(
      "WORKSPACE_CONTEXT_WORKSPACE_REQUIRED",
      "Workspace Context에는 workspaceId가 필요합니다.",
    );
  }

  if (!WORKSPACE_ROLES.includes(role)) {
    throw workspaceContextError(
      "WORKSPACE_CONTEXT_ROLE_INVALID",
      `Workspace role은 ${WORKSPACE_ROLES.join(" 또는 ")}만 허용됩니다.`,
    );
  }

  return Object.freeze({
    userId,
    workspaceId,
    role,
  });
}

export function requireWorkspaceContext(input = {}) {
  const source = input?.workspaceContext ?? input;
  return normalizeWorkspaceContext(source);
}

export function createUnconfiguredWorkspaceContextProvider() {
  return Object.freeze({
    configured: false,
    async getCurrent() {
      throw workspaceContextError(
        "WORKSPACE_CONTEXT_NOT_CONFIGURED",
        "Workspace Context provider가 아직 연결되지 않았습니다.",
      );
    },
  });
}
