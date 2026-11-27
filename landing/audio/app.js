import { audioCopy } from './copy.js';

const c = audioCopy[document.documentElement.lang] || audioCopy.en;
const $ = selector => document.querySelector(selector);
const workspace = $('#audio-workspace');
const picker = $('#audio-file');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatText = text => text.replace('{format}', info?.format.toUpperCase() || '');
const say = text => { $('#audio-announcement').textContent = text; };
const icons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg>',
};
let state = 'empty', phase = '', percent = null, remaining = null, errorCode = '';
let file, info, worker, startupTimer, autoRun = false;
let originalURL, resultURL, resultName, listening = 'processed', noMusic = false;
let supported = null;
const audio = new Audio();
audio.preload = 'metadata';
const busy = () => ['checking', 'working'].includes(state);
const plural = new Intl.PluralRules(document.documentElement.lang === 'ar' ? 'ar' : 'en');
// Shown once the first window is done: whole minutes, rounded up.
function timeLeft(seconds) {
  if (seconds === null) return '';
  if (seconds < 60) return c.left.soon;
  const minutes = Math.ceil(seconds / 60);
  return (c.left[plural.select(minutes)] || c.left.other).replace('{n}', minutes);
}

// Keep the screen on while a file is processed: phones pause hidden pages.
// Best effort; the lock is released whenever the page is hidden, so it is
// taken again when the page comes back.
let wakeLock = null, waking = false;
async function keepAwake() {
  if (wakeLock || waking || state !== 'working' || document.visibilityState !== 'visible') return;
  waking = true;
  try {
    wakeLock = await navigator.wakeLock?.request('screen') ?? null;
    wakeLock?.addEventListener('release', () => { wakeLock = null; });
    if (state !== 'working') allowSleep();
  } catch { wakeLock = null; } finally { waking = false; }
}
function allowSleep() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', keepAwake);

function stopWorker() {
  allowSleep();
  clearTimeout(startupTimer);
  worker?.terminate();
  worker = undefined;
}
function releaseAudio() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (originalURL) URL.revokeObjectURL(originalURL);
  if (resultURL) URL.revokeObjectURL(resultURL);
  originalURL = resultURL = undefined;
}
function button(action, text, primary = false, disabled = false) {
  return `<button type="button" class="${primary ? 'button audio-primary' : 'audio-text'}" data-action="${action}"${disabled ? ' disabled' : ''}>${text}</button>`;
}
function row(change = false) {
  if (!file) return '';
  return `<div class="audio-file-row"><span class="audio-file-type">${info ? info.format.toUpperCase() : '—'}</span><div class="audio-file-info"><p class="audio-file-name" dir="auto" title="${escape(file.name)}">${escape(file.name)}</p><p class="audio-meta"><bdi>${info ? time(info.duration) + ' · ' : ''}${(file.size / 1024 / 1024).toFixed(1)} MB</bdi></p></div>${change ? button('choose', c.change) : ''}</div><hr>`;
}
function render(focus = false) {
  const previousAction = workspace.contains(document.activeElement) ? document.activeElement.dataset.action : null;
  workspace.dataset.state = state;
  workspace.setAttribute('aria-busy', String(busy()));
  let html = '';
  if (state === 'empty') {
    html = `<div class="audio-empty"><div><h2>${c.drop}</h2><p class="audio-small">${c.types}</p></div>${button('choose', c.choose, true, supported === false)}<p class="audio-hint">${c.limits}</p></div>`;
  } else if (state === 'unsupported') {
    html = `<div class="audio-empty"><h2>${c.browserTitle}</h2><p class="audio-small">${c.browserCopy}</p>${button('choose', c.unavailable, true, true)}</div>`;
  } else if (state === 'ready') {
    html = `${row(true)}<div class="audio-ready"><p class="audio-small">${formatText(c.output)}</p>${button('run', c.remove, true)}<p class="audio-hint">${c.first}</p></div>`;
  } else if (busy()) {
    const label = state === 'checking' ? 'checking' : phase;
    html = `${row()}<div class="audio-progress-content"><div class="audio-status-heading"><h2>${c[label]}</h2><span class="audio-percent" aria-hidden="true">${percent === null ? '' : percent + '%'}</span></div><progress max="100"${percent === null ? '' : ` value="${percent}"`} aria-label="${c[label]}"></progress><p class="audio-small" id="audio-progress-copy">${c[label + 'Copy']}</p>${label === 'processing' ? `<p class="audio-small" id="audio-remaining">${timeLeft(remaining)}</p>` : ''}</div><div class="audio-cancel">${button('cancel', c.cancel)}</div>`;
  } else if (state === 'done') {
    html = `${row()}<h2>${c.done}</h2>${noMusic ? `<p class="audio-small">${c.noMusic}</p>` : ''}<div class="audio-listen" role="group" aria-label="${c.compare}"><button type="button" data-action="processed" aria-pressed="true">${c.processed}</button><button type="button" data-action="original" aria-pressed="false">${c.original}</button></div><div class="audio-player" dir="ltr"><button type="button" class="audio-play" data-action="play" aria-label="${c.play}">${icons.play}</button><input type="range" min="0" max="${info.duration}" step="0.1" value="0" aria-label="${c.seek}" id="audio-seek"><span class="audio-time"><span id="audio-elapsed">0:00</span> / ${time(info.duration)}</span></div><p class="audio-small" id="audio-preview-error" role="status" hidden></p><div class="audio-done-actions"><a class="button audio-primary" href="${resultURL}" download="${escape(resultName)}">${icons.download}${formatText(c.downloadFile)}</a>${button('reset', c.another)}</div>`;
  } else if (state === 'error') {
    const retryable = !errorCode.startsWith('file-') && errorCode !== 'decode-unsupported';
    html = `${row()}<div class="audio-error" role="alert"><h2>${retryable ? c.failed : c.errorTitle}</h2><p class="audio-small">${c.errors[errorCode] || c.errors.processing}</p></div><div class="audio-done-actions">${retryable ? button('retry', c.retry, true) : ''}${button('choose', c.another, !retryable)}</div>`;
  }
  workspace.innerHTML = html;
  if (focus) (workspace.querySelector('button:not(:disabled), a') || workspace).focus({ preventScroll: true });
  else if (previousAction) workspace.querySelector(`[data-action="${previousAction}"]`)?.focus({ preventScroll: true });
}
function showError(code) {
  stopWorker();
  autoRun = false;
  errorCode = code;
  state = 'error';
  render(true);
  say(c.errors[code] || c.errors.processing);
}
function startWorker() {
  stopWorker();
  try {
    if (!isSecureContext || !globalThis.Worker || !globalThis.WebAssembly) throw new Error('Unsupported');
    const current = worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    startupTimer = setTimeout(() => showError('runtime'), 15000);
    current.onmessage = ({ data }) => {
      if (current !== worker) return;
      if (data.type === 'capability') {
        clearTimeout(startupTimer);
        supported = data.supported;
        if (!supported) return unavailable();
        if (file && state === 'checking') current.postMessage({ type: 'inspect', file });
      } else if (data.type === 'ready') {
        info = data.info;
        state = 'ready';
        render(true);
        say(c.ready);
        if (autoRun) { autoRun = false; run(); }
      } else if (data.type === 'progress') {
        const changed = state !== 'working' || phase !== data.phase;
        state = 'working'; phase = data.phase; percent = data.percent; remaining = data.remaining ?? null;
        keepAwake();
        if (changed) { render(); say(c[phase]); }
        else {
          const progress = workspace.querySelector('progress');
          if (percent === null) progress.removeAttribute('value'); else progress.value = percent;
          workspace.querySelector('.audio-percent').textContent = percent === null ? '' : percent + '%';
          const left = workspace.querySelector('#audio-remaining');
          if (left) left.textContent = timeLeft(remaining);
        }
      } else if (data.type === 'done') {
        resultURL = URL.createObjectURL(new Blob([data.buffer], { type: data.mime }));
        originalURL = URL.createObjectURL(file);
        resultName = file.name.replace(/\.(mp3|m4a)$/i, '') + '-musicless.' + info.format;
        listening = 'processed';
        // Only the detector can say no window has music: the model never ran.
        noMusic = data.separated === 0;
        audio.src = resultURL;
        state = 'done';
        stopWorker();
        render(true);
        say(noMusic ? `${c.done}. ${c.noMusic}` : c.done);
      } else if (data.type === 'error') showError(data.code);
    };
    current.onerror = event => {
      event.preventDefault();
      showError(state === 'working' ? 'processing' : 'runtime');
    };
  } catch { unavailable(); }
}
function unavailable() {
  stopWorker(); supported = false; state = 'unsupported'; autoRun = false; render(); say(c.browserCopy);
}
function selectFiles(files) {
  if (!files.length || busy() || supported === false) return;
  releaseAudio();
  stopWorker();
  info = undefined;
  if (files.length !== 1) { file = undefined; return showError('file-multiple'); }
  file = files[0];
  inspectFile();
}
function inspectFile() {
  state = 'checking'; percent = null; render();
  startWorker();
}
function run() {
  if (state !== 'ready' || !worker) return;
  state = 'working'; phase = 'preflight'; percent = null; remaining = null;
  render(true); say(c.preflight);
  keepAwake();
  worker.postMessage({ type: 'run' });
}
function reset() {
  stopWorker(); releaseAudio(); file = info = undefined; autoRun = false;
  picker.value = '';
  state = supported === false ? 'unsupported' : 'empty'; render(true);
}

workspace.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'choose') { picker.value = ''; picker.click(); }
  if (action === 'run') run();
  if (action === 'cancel') {
    stopWorker(); autoRun = false;
    if (state === 'checking') reset(); else inspectFile();
    say(c.canceled);
  }
  if (action === 'reset') reset();
  if (action === 'retry') {
    if (file) { autoRun = true; inspectFile(); }
    else { state = 'empty'; render(true); startWorker(); }
  }
  if (action === 'play') {
    if (!audio.paused) audio.pause();
    else try { await audio.play(); } catch { previewError(); }
  }
  if (action === 'processed' || action === 'original') {
    if (action === listening) return;
    const position = audio.currentTime;
    const resume = !audio.paused;
    audio.pause(); listening = action;
    audio.src = action === 'processed' ? resultURL : originalURL;
    audio.currentTime = position;
    for (const btn of workspace.querySelectorAll('.audio-listen button')) btn.setAttribute('aria-pressed', String(btn.dataset.action === action));
    if (resume) try { await audio.play(); } catch { previewError(); }
  }
});
picker.addEventListener('change', () => selectFiles(picker.files));
workspace.addEventListener('dragover', event => {
  event.preventDefault();
  if (!busy() && supported !== false) workspace.classList.add('dragging');
});
workspace.addEventListener('dragleave', event => { if (!workspace.contains(event.relatedTarget)) workspace.classList.remove('dragging'); });
workspace.addEventListener('drop', event => { event.preventDefault(); workspace.classList.remove('dragging'); selectFiles(event.dataTransfer.files); });
workspace.addEventListener('input', event => { if (event.target.id === 'audio-seek') audio.currentTime = Number(event.target.value); });
function updatePlayer() {
  const play = workspace.querySelector('.audio-play');
  if (!play) return;
  play.innerHTML = audio.paused ? icons.play : icons.pause;
  play.setAttribute('aria-label', audio.paused ? c.play : c.pause);
  $('#audio-seek').value = audio.currentTime;
  $('#audio-elapsed').textContent = time(audio.currentTime);
}
function previewError() {
  const el = $('#audio-preview-error');
  if (el) { el.hidden = false; el.textContent = c.previewError; }
}
for (const name of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata']) audio.addEventListener(name, updatePlayer);
audio.addEventListener('error', previewError);

const tabs = [...document.querySelectorAll('[data-mode]')];
function switchMode(mode, focus = false) {
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }
  $('#files-panel').hidden = mode !== 'files';
  $('#youtube-panel').hidden = mode !== 'youtube';
  for (const el of document.querySelectorAll('[data-youtube-section], [data-youtube-questions]')) el.hidden = mode !== 'youtube';
  document.querySelector('[data-files-questions]').hidden = mode !== 'files';
  if (mode !== 'files') audio.pause();
  if (mode === 'files' && supported === null && !worker) startWorker();
  for (const link of document.querySelectorAll('.language-options a')) link.hash = mode === 'files' ? 'files' : '';
}
for (const tab of tabs) {
  tab.addEventListener('click', () => { switchMode(tab.dataset.mode); history.replaceState(null, '', '#' + tab.dataset.mode); });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - tabs.indexOf(tab);
    switchMode(tabs[index].dataset.mode, true);
    history.replaceState(null, '', '#' + tabs[index].dataset.mode);
  });
}
document.querySelector('a[href="#how"]').addEventListener('click', () => switchMode('youtube'));
window.addEventListener('hashchange', () => { if (['#files', '#youtube', '#how', '#film'].includes(location.hash)) switchMode(location.hash === '#files' ? 'files' : 'youtube'); });
window.addEventListener('beforeunload', event => { if (busy()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { stopWorker(); releaseAudio(); });
window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
render();
switchMode(location.hash === '#files' ? 'files' : 'youtube');
