import { th } from "./th";
import { en } from "./en";
import { tr } from "./tr";
import { useStore } from "../store";

const locales = { th, en, tr } as const;

export type Lang = keyof typeof locales;

export function useT() {
  const lang = useStore((s) => s.lang);
  return (key: string, params?: Record<string, string | number>): string => {
    const locale = locales[lang as Lang] ?? locales.tr;
    // Fall back to Turkish, then English, then the raw key so a missing entry
    // never surfaces as an empty string in the UI.
    const table = locale as Record<string, string>;
    let text = table[key] ?? (locales.tr as Record<string, string>)[key] ?? (locales.en as Record<string, string>)[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return text;
  };
}
