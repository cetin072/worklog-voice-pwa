export const WORKSPACE_ROLES = Object.freeze(["owner", "member"]);

const MAX_CONTEXT_ID_LENGTH = 200;

function text(value) {
  return String(value ?? "").trim();
}

function workspaceContextError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeIdentifier(value, fieldName) {
  const normalized = text(value);
  const upperField = fieldName === "userId" ? "USER" : "WORKSPACE";

  if (!normalized) {
    throw workspaceContextError(
      `WORKSPACE_CONTEXT_${upperField}_REQUIRED`,
      `Workspace Context에는 ${fieldName}가 필요합니다.`,
    );
  }

  if (normalized.length > MAX_CONTEXT_ID_LENGTH) {
    throw workspaceContextError(
      `WORKSPACE_CONTEXT_${upperField}_INVALID`,
      `${fieldName}가 허용 길이를 초과했습니다.`,
    );
  }

  return normalized;
}

export function normalizeWorkspaceContext(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const userId = normalizeIdentifier(source.userId ?? source.user_id, "userId");
  const workspaceId = normalizeIdentifier(source.workspaceId ?? source.workspace_id, "workspaceId");
  const role = text(source.role).toLowerCase();

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
