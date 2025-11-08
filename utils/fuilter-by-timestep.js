
export function isNewMessage(startMs, upTs) {
  if (typeof upTs === 'number') {
    const upMs = upTs > 1e12 ? upTs : upTs * 1000;
    if (upMs <= startMs) return false;
  }
  return true;
}