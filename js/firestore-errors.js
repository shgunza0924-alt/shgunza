// Shared, user-safe Firestore error messages. Detailed causes stay in the console.

export function getFirestoreErrorCode(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "network-error";
  }

  return String(error?.code || "")
    .replace(/^firestore\//, "")
    .replace(/^auth\//, "");
}

export function logFirestoreError(context, error) {
  const code = getFirestoreErrorCode(error) || "unknown";
  console.error(`[Firestore] ${context} failed`, {
    code,
    message: error?.message || String(error || "Unknown error"),
  }, error);
}

export function getFirestoreErrorMessage(error, action = "요청") {
  const code = getFirestoreErrorCode(error);

  if (code === "resource-exhausted") {
    return `현재 ${action} 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.`;
  }
  if (code === "permission-denied") {
    return `${action} 권한을 확인할 수 없습니다. 관리자에게 문의해주세요.`;
  }
  if (code === "unauthenticated") {
    return `로그인 상태가 만료되었습니다. 새로고침한 뒤 ${action}을 다시 시도해주세요.`;
  }
  if (code === "unavailable") {
    return `서비스에 일시적으로 연결할 수 없습니다. 잠시 후 ${action}을 다시 시도해주세요.`;
  }
  if (code === "network-error" || code === "network-request-failed") {
    return `네트워크 연결을 확인한 뒤 ${action}을 다시 시도해주세요.`;
  }
  if (code === "failed-precondition") {
    return `${action}을 위한 조회 준비가 필요합니다. 관리자에게 문의해주세요.`;
  }

  return `${action} 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;
}
