const ua = navigator.userAgent;
const browser = /(Firefox|Chrome|Chromium)\/(\d+)/.exec(ua);
const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
// iPads and Android tablets can identify as desktop Macs or Linux PCs, even with a mouse.
const possibleTablet = navigator.maxTouchPoints > 0 && /Macintosh|Linux/.test(ua);

// The store buttons and the film are on the landing only, not the text pages.
if (browser && !mobile && !possibleTablet) {
  const store = browser[1] === 'Firefox' ? 'firefox' : 'chrome';
  const link = document.querySelector(`[data-store="${store}"]`);
  if (link && Number(browser[2]) >= Number(link.dataset.minVersion)) {
    link.querySelector('span').textContent = link.dataset.installLabel;
    link.classList.add('preferred');
    link.parentElement.prepend(link);
  }
}

const language = document.querySelector('.language');
document.addEventListener('click', event => {
  if (!language.contains(event.target)) language.open = false;
});
language.addEventListener('focusout', event => {
  if (!language.contains(event.relatedTarget)) language.open = false;
});
language.addEventListener('keydown', event => {
  if (event.key === 'Escape' && language.open) {
    language.open = false;
    language.querySelector('summary').focus();
  }
});

const film = document.querySelector('.film-play');
film?.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const player = document.createElement('iframe');
  player.title = document.getElementById('film-title').textContent;
  player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  player.allowFullscreen = true;
  player.referrerPolicy = 'strict-origin-when-cross-origin';
  player.src = `https://www.youtube-nocookie.com/embed/${film.dataset.videoId}?autoplay=1&playsinline=1&hl=${document.documentElement.lang}`;
  film.replaceWith(player);
  player.focus();
});
