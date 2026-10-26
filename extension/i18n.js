// Strings from _locales/<locale>/messages.json. Chrome picks the locale from
// the browser's UI language and falls back to English per message. Callers in
// the content script resolve their strings while loading: a page that outlives
// the extension (updated or removed) keeps its texts without chrome.i18n.

export const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

// The catalog's language and writing direction, for lang/dir on anything we
// render (an Arabic nomusic may sit on an English YouTube page, and the
// reverse). They come from the catalog itself: Chrome can serve one locale's
// messages while reporting another as its UI language (seen with --lang).
const ui = { lang: t("locale_code"), dir: t("locale_dir") === "rtl" ? "rtl" : "ltr" };

export function setLanguage(element) {
  element.lang = ui.lang;
  element.dir = ui.dir;
  return element;
}

// Fill an extension page: elements with data-i18n get the message as text;
// data-i18n-args names the messages whose texts fill its placeholders.
export function localizePage(root = document) {
  setLanguage(root.documentElement);
  for (const element of root.querySelectorAll("[data-i18n]")) {
    const args = element.dataset.i18nArgs?.split(/\s+/).map((key) => t(key)) ?? [];
    element.textContent = t(element.dataset.i18n, ...args);
  }
}

// A message with the player button's glyph in its sentence, where the catalog
// puts {icon}; the glyph is named for screen readers by the button's own name.
export function localizeWithGlyph(element, key, { on = false } = {}) {
  const glyph = document.createElement("span");
  glyph.className = on ? "glyph glyph-on" : "glyph glyph-off";
  glyph.setAttribute("role", "img");
  glyph.setAttribute("aria-label", t(on ? "control_on" : "control_name"));
  const [before, after = ""] = t(key).split("{icon}");
  element.replaceChildren(before, glyph, after);
}
