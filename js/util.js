export function warrantyStatus(warrantyExpiry) {
  if (!warrantyExpiry) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(warrantyExpiry + "T00:00:00");
  if (Number.isNaN(expiry.getTime())) return null;
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0) return { level: "expired", days, label: "保証期限切れ" };
  if (days <= 30) return { level: "soon", days, label: `保証期限まであと${days}日` };
  return { level: "ok", days, label: `保証期限: ${warrantyExpiry}` };
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function showToast(message, ms = 2400) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, ms);
}
