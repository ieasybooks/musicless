// This page only chooses which bundled policy text to show. Reading it does
// not change consent or settings, and needs no network access.
const sections = [...document.querySelectorAll("main > section")];
const preferred = globalThis.chrome?.i18n?.getMessage("locale_code") === "ar" ? "ar" : "en";

function showLanguage() {
  const requested = location.hash.slice(1);
  const language = ["en", "ar"].includes(requested) ? requested : preferred;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  for (const section of sections) section.hidden = section.id !== language;
  document.title = document.getElementById(language).querySelector("h1").textContent;
  for (const link of document.querySelectorAll("nav a")) {
    if (link.hash === `#${language}`) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

showLanguage();
window.addEventListener("hashchange", () => {
  showLanguage();
  window.scrollTo(0, 0);
});
