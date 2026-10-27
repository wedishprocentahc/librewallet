import { locales } from "./locales.js";
import { extra } from "./strings.js";

let lang = "pl";
export const setLang = (l) => { lang = l === "en" ? "en" : "pl"; document.documentElement.lang = lang; };
export const getLang = () => lang;

export function t(key, args) {
  let s = extra[lang]?.[key] ?? locales[lang]?.[key] ?? extra.pl[key] ?? locales.pl[key] ?? key;
  if (args) for (const [k, v] of Object.entries(args)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
export const assetLabel = (k) => (locales.pl[`asset.${k}`] ? t(`asset.${k}`) : k);
export const typeLabel = (k) => t(`type.${k}`);
