// Thin client for the local backend. All data stays on this device; the header below is required by the
// server for writes (it blocks cross-site requests).
async function request(method, path, { json, body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "X-LibreWallet": "1", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, json = {}) => request("POST", path, { json }),
  put: (path, json = {}) => request("PUT", path, { json }),
  del: (path) => request("DELETE", path),
  upload: (path, file, headers) => request("POST", path, { body: file, headers: { "Content-Type": "application/octet-stream", ...headers } }),
  text: (path) => request("GET", path),
  postText: (path, text) => request("POST", path, { body: text, headers: { "Content-Type": "application/json" } }),
};
