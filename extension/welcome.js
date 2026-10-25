// Welcome page: the disclosure and the choice that turns nomusic on, then the guide.
import { localizePage, t } from "./i18n.js";

localizePage();
const $ = (id) => document.getElementById(id);

function settle(key, on) {
  $("consent").hidden = true;
  $("status").textContent = t(key);
  $("status").classList.toggle("on", on);
  $("status").hidden = false;
  $("status").focus();
}

chrome.storage.sync.get({ consented: false }).then(({ consented }) => {
  if (consented) settle("consent_done", true);
  else $("consent").hidden = false;
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  settle("consent_done", true);
});
$("later").addEventListener("click", () => settle("consent_later_done", false));
