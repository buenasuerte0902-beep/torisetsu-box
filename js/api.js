async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `リクエストに失敗しました (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (password) => request("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request("/api/logout", { method: "POST" }),
  session: () => request("/api/session"),

  listItems: ({ q, category } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    const qs = params.toString();
    return request(`/api/items${qs ? `?${qs}` : ""}`);
  },
  createItem: (data) => request("/api/items", { method: "POST", body: JSON.stringify(data) }),
  getItem: (id) => request(`/api/items/${id}`),
  updateItem: (id, data) => request(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteItem: (id) => request(`/api/items/${id}`, { method: "DELETE" }),

  uploadFile: (itemId, kind, file) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    return request(`/api/items/${itemId}/files`, { method: "POST", body: form });
  },
  deleteFile: (id) => request(`/api/files/${id}`, { method: "DELETE" }),
};
