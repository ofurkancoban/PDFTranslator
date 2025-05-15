// src/utils/apiBase.ts
export function getApiBase() {
  // Eğer URL path’inde /pdftranslator… ile başlayan bir şey varsa onu yakala (Railway prod için)
  const base = window.location.pathname.match(/^\/pdftranslator[^\/]*\//);
  return base ? base[0] : '/';
}