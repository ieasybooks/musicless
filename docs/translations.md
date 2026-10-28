# Translations

Every user-visible string of the extension lives in `extension/_locales/en/messages.json`
(English, the default) and `extension/_locales/ar/messages.json` (Arabic). Chrome picks the
language from the browser's UI language and falls back to English per message. This table
is for review by a native speaker; the Arabic is Modern Standard Arabic, plain and short.
`tests/unit/translations.test.mjs` checks that the table matches both catalogs.

Conventions
- Keep Musicless, YouTube (YouTube™ where the English has it), Chrome Sync, Chrome, Edge, Brave,
  Chromium, GitHub and Google in Latin script, in running text and in labels alike. Never
  transliterate Musicless.
- Glossary: voices = الأصوات البشرية; voice = الصوت البشري; sound or audio (the video's audio) =
  الصوت; music = الموسيقى; background music = موسيقى الخلفية; musical instruments =
  الآلات الموسيقية; the sounds of instruments = أصوات الآلات الموسيقية; speech = الكلام;
  singing = الغناء; quiet music = الموسيقى الخافتة (volume, not a genre); computer = الحاسوب;
  setting = إعداد; original audio = الصوت الأصلي (in prose only, never on the recovery button).
- Buttons use short, familiar labels: تفعيل، إزالة الموسيقى، تشغيل مع الموسيقى، إعادة
  المحاولة، إعادة تحميل الصفحة. "Turn on" stays تفعيل so it is distinct from playing a
  video. The player toggle says what its click does: إزالة الموسيقى / إعادة الموسيقى.
  Instructions address the reader directly (اضغط، انتظر، جرّب), in plain Modern Standard
  Arabic rather than a dialect. Progress is جارٍ إزالة الموسيقى. Failure and enabled
  states remain explicit: لم تُزَل الموسيقى and تم تفعيل Musicless.
- Prefer a clear next step to an implementation detail. Keep the actual reason when it
  affects the choice, such as copy protection. Do not imply that a reload always works.
  Privacy copy must still explain audio access, local processing, no audio saving or
  uploading, and settings sync. {icon} is replaced by the actual player-button glyph.
- Western digits; no ellipsis (a spinner already says that something is in progress); the
  Arabic comma ، in Arabic text; typographic apostrophes (’) in English. Latin tokens
  (Musicless, Chrome Sync, 400) keep their logical order inside right-to-left text; "Chrome
  Sync" is joined by a no-break space so a line never breaks inside it. Character counts
  include combining marks and are not rendered widths.

| Key | English | Arabic | Notes |
|---|---|---|---|
| `locale_code` | en | <div dir="rtl">ar</div> | Not translated: the catalog's language code, used for the lang attribute. |
| `locale_dir` | ltr | <div dir="rtl">rtl</div> | Not translated: the catalog's writing direction. Pages and the in-player UI take their direction from it. |
| `extension_name` | Musicless | <div dir="rtl">Musicless</div> | Brand; never translated or transliterated. |
| `extension_description` | Removes most of the background music from YouTube™ videos and keeps the voices. Everything runs on your computer. | <div dir="rtl">يزيل معظم موسيقى الخلفية من فيديوهات YouTube™‎ ويُبقي الأصوات البشرية. يعمل كل شيء على حاسوبك.</div> | The store summary and the extensions-page description (132 characters at most). "Voices" = الأصوات البشرية, kept apart from "sound" (الصوت). In Arabic a left-to-right mark (U+200E) follows ™, so that it stays on YouTube's right in right-to-left text. |
| `control_name` | Remove music | <div dir="rtl">إزالة الموسيقى</div> | Name of the player button (a toggle: screen readers add pressed or not) and its tooltip while the music plays. Like YouTube's own "Mute", it says what a click does. |
| `control_on` | Bring back music | <div dir="rtl">إعادة الموسيقى</div> | Restores this video’s music without implying that a paused video will start. The recovery choice remains Play with music / تشغيل مع الموسيقى. |
| `control_setup` | Turn on Musicless | <div dir="rtl">تفعيل Musicless</div> | Tooltip and name of the player button before the first run, when it shows the note with a small dot; it opens the first-run page. On YouTube's page the brand names what will be turned on; تفعيل as on the first-run button. |
| `control_failed` | Music not removed | <div dir="rtl">لم تُزَل الموسيقى</div> | Tooltip and name of the player button after a failure (the note with a small dot); a click opens the choice again. Failure state: لم تُزَل. |
| `notice_working` | Removing music | <div dir="rtl">جارٍ إزالة الموسيقى</div> | Progress beneath the spinner. جارٍ إزالة الموسيقى is a familiar Arabic progress label, replacing the passive تُزال الموسيقى. |
| `notice_done` | Music removal is on | <div dir="rtl">إزالة الموسيقى مفعّلة</div> | Not shown: screen readers hear it once when a wait ends and the video plays without its music. |
| `notice_blocked` | Click to play | <div dir="rtl">انقر للتشغيل</div> | The name of the round play button in the middle of the video when the browser needs a click before it plays sound (read by screen readers; the button shows only the play sign). |
| `panel_title` | Couldn’t remove the music | <div dir="rtl">تعذّرت إزالة الموسيقى</div> | Title of the failure dialog; the reason follows it. تعذّرت = could not be done (no blame). |
| `panel_retry` | Try again | <div dir="rtl">إعادة المحاولة</div> | Failure dialog action. Buttons use the verbal noun, as Chrome's and YouTube's Arabic do (إعادة المحاولة). |
| `panel_reload` | Reload page | <div dir="rtl">إعادة تحميل الصفحة</div> | Failure dialog action when only a fresh page can help. إعادة تحميل, never تحديث (that would read as updating the extension). |
| `panel_original` | Play with music | <div dir="rtl">تشغيل مع الموسيقى</div> | Failure dialog action that plays the video with its music. Must say "music" plainly; never "original". The dialog's only action when nothing else can help (copy-protected, unsupported format, unreachable player). |
| `failure_protected` | This video is copy-protected. | <div dir="rtl">هذا الفيديو محمي من النسخ.</div> | Copy-protected = محمي من النسخ (the owner locked the video, as rented movies are). The dialog's title already says the music could not be removed. |
| `failure_codec` | Musicless can’t work with this video’s audio. | <div dir="rtl">لا يدعم Musicless الصوت في هذا الفيديو.</div> | Unsupported audio; avoid requiring the user to understand codecs. Only Play with music is available. |
| `failure_missed` | Reload this page to start removing music. | <div dir="rtl">أعد تحميل الصفحة لبدء إزالة الموسيقى.</div> | Under the title "Musicless is on" (`done_heading`), on a video that was already playing when the user turned Musicless on: not a failure, a reload is all it needs. The main action is "Reload page". |
| `failure_uncaptured` | Try reloading the page. | <div dir="rtl">جرّب إعادة تحميل الصفحة.</div> | Suggests reloading without claiming that it usually or always fixes the problem. |
| `failure_source` | Musicless can’t access the sound in this video. | <div dir="rtl">لا يستطيع Musicless الوصول إلى صوت هذا الفيديو.</div> | The audio cannot be accessed. Names the video instead of referring to an unreachable player. |
| `failure_slow` | This is taking longer than expected. Try again in a moment. | <div dir="rtl">تستغرق إزالة الموسيقى وقتًا أطول من المتوقع. حاول مرة أخرى بعد قليل.</div> | Explains the delay and suggests retrying without guessing that the computer is busy. |
| `failure_engine` | Try reloading the page. | <div dir="rtl">جرّب إعادة تحميل الصفحة.</div> | The offered next step is Reload page. Do not expose engine details. |
| `failure_error` | Something went wrong. | <div dir="rtl">حدث خطأ ما.</div> | The cause is unknown; the two actions follow. |
| `failure_audio` | The sound didn’t start. Try reloading the page. | <div dir="rtl">لم يعمل الصوت. جرّب إعادة تحميل الصفحة.</div> | Says the sound did not start and gives the available next step. |
| `failure_updated` | Musicless was updated or turned off. Reload the page to continue. | <div dir="rtl">تم تحديث Musicless أو إيقافه. أعد تحميل الصفحة للمتابعة.</div> | Shown after the extension was updated or removed; chrome.i18n is gone by then, so the text is resolved at load. |
| `setup_heading` | Watch YouTube without the music | <div dir="rtl">شاهد YouTube بدون موسيقى</div> | Heading of the first-run page: what the user gets. An imperative, as the English (شاهد). |
| `consent_text` | Musicless uses the audio from the YouTube videos you watch to remove most of the music, all on your computer. It never saves or uploads the audio. Your settings may sync through Chrome Sync. | <div dir="rtl">يستخدم Musicless صوت فيديوهات YouTube التي تشاهدها لإزالة معظم الموسيقى، على حاسوبك فقط. لا يحفظ الصوت ولا يرسله إلى أي مكان. قد تتزامن إعداداتك عبر Chrome Sync.</div> | Before consent, explain that the videos’ audio is used only on the computer to remove most music, never saved or uploaded, and settings may sync through Chrome Sync. Arabic says لا يرسله rather than يرفعه, which can mean turning up the volume. Keep the no-break spaces in فيديوهات YouTube and Chrome Sync. |
| `consent_accept` | Turn on | <div dir="rtl">تفعيل</div> | The one button of the disclosure: the user's affirmative consent. تفعيل, as Chrome's Arabic says "Turn on" (تشغيل would read as "Play" next to YouTube). |
| `done_heading` | Musicless is on | <div dir="rtl">تم تفعيل Musicless</div> | First-run page after the choice, in Chrome's "[name] is on" pattern (تم تفعيل, matching the تفعيل button). Also the title of the dialog on a video that was already playing when the user turned Musicless on (`failure_missed`). |
| `done_wait` | Give Musicless a few seconds at the start of each video to remove the music. | <div dir="rtl">انتظر بضع ثوانٍ في بداية كل فيديو حتى يزيل Musicless الموسيقى.</div> | Addresses the reader and explains the wait at the start of each video. |
| `done_control` | Click {icon} in the video to bring the music back. | <div dir="rtl">اضغط على {icon} في الفيديو لإعادة الموسيقى.</div> | Direct instruction for bringing the music back. Preserve {icon}; it becomes the crossed-out note. |
| `done_text` | If YouTube was already open, reload that page. | <div dir="rtl">إذا كان YouTube مفتوحًا قبل التفعيل، فأعد تحميل صفحته.</div> | If YouTube was open before activation, reload that page. The conditional avoids asking users to reload unnecessarily. |
| `done_open` | Open YouTube | <div dir="rtl">فتح YouTube</div> | Button that opens youtube.com in the same tab (verbal noun فتح). |
| `done_back` | Back to the video | <div dir="rtl">العودة إلى الفيديو</div> | Button instead of "Open YouTube" when the page was opened from a video's button: goes back to that tab and reloads it where the video was (verbal noun العودة). |
| `popup_autostart_label` | Remove music automatically | <div dir="rtl">إزالة الموسيقى تلقائيًا</div> | Names the automatic-removal setting shown after activation. Turning it off leaves removal available through the video button. |
| `popup_one_video` | Click {icon} in a video to remove its music. | <div dir="rtl">اضغط على {icon} في الفيديو لإزالة الموسيقى.</div> | Shown only when automatic removal is off. Directly explains how to use the video button; preserve {icon}. |
| `link_help` | Help | <div dir="rtl">مساعدة</div> | Link to the help (how Musicless works, what to do); reporting a problem is one link further. مساعدة without the article, as Google's menus. |
| `link_help_url` | https://github.com/IbraheemTuffaha/musicless#using-musicless | <div dir="rtl">https://github.com/IbraheemTuffaha/musicless/blob/main/docs/help.ar.md</div> | Not translated as text: the address of the help in this language (README's "Using Musicless" in English, docs/help.ar.md in Arabic). |
| `link_privacy` | Privacy policy | <div dir="rtl">سياسة الخصوصية</div> | The published privacy policy. |
