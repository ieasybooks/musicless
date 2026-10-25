// Welcome page: the disclosure and the choice that turns nomusic on, then the guide.
import { localizePage, t } from "./i18n.js";

localizePage();
const $ = (id) => document.getElementById(id);

function settle(key) {
  $("consent").hidden = true;
  $("status").textContent = t(key);
  $("status").hidden = false;
  $("status").focus();
}

chrome.storage.sync.get({ consented: false }).then(({ consented }) => {
  if (consented) settle("consent_done");
  else $("consent").hidden = false;
});
$("accept").addEventListener("click", async () => {
  await chrome.storage.sync.set({ consented: true });
  settle("consent_done");
});
$("later").addEventListener("click", () => settle("consent_later_done"));
