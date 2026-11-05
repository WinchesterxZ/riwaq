import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";

export type Lang = "ar" | "en";

const stored = localStorage.getItem("atlas.lang");
const initial: Lang = stored === "en" || stored === "ar" ? stored : "ar";

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function applyLang(lang: Lang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = lang === "ar" ? "رِواق | RIWAQ" : "RIWAQ | رِواق";
  localStorage.setItem("atlas.lang", lang);
}

applyLang(initial);

i18n.on("languageChanged", (lng) => applyLang(lng as Lang));

export default i18n;
