# Translations

Every user-visible string of the extension lives in `extension/_locales/en/messages.json`
(English, the default) and `extension/_locales/ar/messages.json` (Arabic). Chrome picks the
language from the browser's UI language and falls back to English per message. This table
is for review by a native speaker; the Arabic is Modern Standard Arabic, plain and short.
`tests/unit/translations.test.mjs` checks that the table matches both catalogs.

Conventions
- Keep nomusic, YouTube (YouTube™ where the English has it), Chrome Sync, Chrome, Edge, Brave,
  Chromium, GitHub and Google in Latin script, in running text and in labels alike. Never
  transliterate nomusic.
- Glossary: voices = الأصوات البشرية; voice = الصوت البشري; sound or audio (the video's audio) =
  الصوت; music = الموسيقى; background music = موسيقى الخلفية; musical instruments =
  الآلات الموسيقية; the sounds of instruments = أصوات الآلات الموسيقية; speech = الكلام;
  singing = الغناء; quiet music = الموسيقى الخافتة (volume, not a genre); computer = الحاسوب;
  setting = إعداد; original audio = الصوت الأصلي (in prose only, never on the recovery button).
- Buttons use the verbal noun, as Chrome's and YouTube's own Arabic buttons do (تفعيل، إعادة
  المحاولة، إعادة تحميل الصفحة، تشغيل مع الموسيقى، إيقاف إزالة الموسيقى، فتح YouTube); "Turn on"
  is تفعيل, as in Chrome, since تشغيل means "Play" beside a video. Feature and setting names are
  noun phrases too (إزالة الموسيقى من كل فيديو); the first-run heading is an imperative, as the
  English is (شاهد YouTube بدون موسيقى). Instructions in sentences use the imperative (استخدم،
  أعد تحميل). Progress is تُزال الموسيقى (the native review should confirm), the failure state
  لم تُزَل الموسيقى, the enabled state تم تفعيل nomusic. (Until this pass the buttons were
  imperatives, حاول مجددًا and شغّل nomusic; the native review should confirm the change.) The
  player button shows the note with a small dot while nomusic waits for the user (before the
  first run, after a failure); {icon} in a sentence is replaced by that button's glyph.
- Western digits; no ellipsis (a spinner already says that something is in progress); the
  Arabic comma ، in Arabic text; typographic apostrophes (’) in English. Latin tokens
  (nomusic, Chrome Sync, 400) keep their logical order inside right-to-left text; "Chrome
  Sync" is joined by a no-break space so a line never breaks inside it. Character counts
  include combining marks and are not rendered widths.

| Key | English | Arabic | Notes |
|---|---|---|---|
| `locale_code` | en | <div dir="rtl">ar</div> | Not translated: the catalog's language code, used for the lang attribute. |
| `locale_dir` | ltr | <div dir="rtl">rtl</div> | Not translated: the catalog's writing direction. Pages and the in-player UI take their direction from it. |
| `extension_name` | nomusic | <div dir="rtl">nomusic</div> | Brand; never translated or transliterated. |
| `extension_description` | Removes most of the background music from YouTube™ videos and keeps the voices. Everything runs on your computer. | <div dir="rtl">يزيل معظم موسيقى الخلفية من فيديوهات YouTube™‎ ويُبقي الأصوات البشرية. يعمل كل شيء على حاسوبك.</div> | The store summary and the extensions-page description (132 characters at most). "Voices" = الأصوات البشرية, kept apart from "sound" (الصوت). In Arabic a left-to-right mark (U+200E) follows ™, so that it stays on YouTube's right in right-to-left text. |
| `control_name` | Remove music | <div dir="rtl">إزالة الموسيقى</div> | Name of the player button (a toggle: screen readers add pressed or not) and its tooltip while the music plays. Like YouTube's own "Mute", it says what a click does. |
| `control_on` | Stop removing music | <div dir="rtl">إيقاف إزالة الموسيقى</div> | Tooltip of the player button while nomusic removes the music: what a click does, as YouTube's "Unmute", with the verb of control_name (إيقاف إزالة, "stopping the removal"). |
| `control_setup` | Turn on nomusic | <div dir="rtl">تفعيل nomusic</div> | Tooltip and name of the player button before the first run, when it shows the note with a small dot; it opens the first-run page. On YouTube's page the brand names what will be turned on; تفعيل as on the first-run button. |
| `control_failed` | Music not removed | <div dir="rtl">لم تُزَل الموسيقى</div> | Tooltip and name of the player button after a failure (the note with a small dot); a click opens the choice again. Failure state: لم تُزَل. |
| `notice_working` | Removing music | <div dir="rtl">تُزال الموسيقى</div> | Under the spinner in the middle of the video while it waits a moment for the first audio without music (at the start, or after a jump). تُزال الموسيقى ("the music is being removed"), the earlier review's phrase; the native review should choose between it and جارٍ إزالة الموسيقى / تجري إزالة الموسيقى. |
| `notice_done` | Music removal is on | <div dir="rtl">إزالة الموسيقى مفعّلة</div> | Not shown: screen readers hear it once when a wait ends and the video plays without its music. |
| `notice_blocked` | Click to play | <div dir="rtl">انقر للتشغيل</div> | The name of the round play button in the middle of the video when the browser needs a click before it plays sound (read by screen readers; the button shows only the play sign). |
| `panel_title` | Couldn’t remove the music | <div dir="rtl">تعذّرت إزالة الموسيقى</div> | Title of the failure dialog; the reason follows it. تعذّرت = could not be done (no blame). |
| `panel_retry` | Try again | <div dir="rtl">إعادة المحاولة</div> | Failure dialog action. Buttons use the verbal noun, as Chrome's and YouTube's Arabic do (إعادة المحاولة). |
| `panel_reload` | Reload page | <div dir="rtl">إعادة تحميل الصفحة</div> | Failure dialog action when only a fresh page can help. إعادة تحميل, never تحديث (that would read as updating the extension). |
| `panel_original` | Play with music | <div dir="rtl">تشغيل مع الموسيقى</div> | Failure dialog action that plays the video with its music. Must say "music" plainly; never "original". The dialog's only action when nothing else can help (copy-protected, unsupported format, unreachable player). |
| `failure_protected` | This video is copy-protected. | <div dir="rtl">هذا الفيديو محمي من النسخ.</div> | Copy-protected = محمي من النسخ (the owner locked the video, as rented movies are). The dialog's title already says the music could not be removed. |
| `failure_codec` | This video’s sound format isn’t supported. | <div dir="rtl">صيغة الصوت في هذا الفيديو غير مدعومة.</div> |  |
| `failure_missed` | Reload the page to remove the music from this video. | <div dir="rtl">أعد تحميل الصفحة لإزالة الموسيقى من هذا الفيديو.</div> | Under the title "nomusic is on" (`done_heading`), on a video that was already playing when the user turned nomusic on: not a failure, a reload is all it needs. The main action is "Reload page". |
| `failure_uncaptured` | Reloading the page usually fixes this. | <div dir="rtl">إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | nomusic could not find the player's sound (it may play in a part of the page nomusic cannot read). The action is "Reload page". |
| `failure_source` | This player’s sound can’t be reached. | <div dir="rtl">لا يمكن الوصول إلى صوت هذا المشغّل.</div> |  |
| `failure_slow` | It’s taking too long. Your computer may be busy. | <div dir="rtl">تستغرق الإزالة وقتًا طويلًا. قد يكون حاسوبك مشغولًا.</div> | Keeps the uncertainty: قد (may). |
| `failure_engine` | Reloading the page usually fixes this. | <div dir="rtl">إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> |  |
| `failure_error` | Something went wrong. | <div dir="rtl">حدث خطأ ما.</div> | The cause is unknown; the two actions follow. |
| `failure_audio` | The sound didn’t start. Reloading the page usually fixes this. | <div dir="rtl">لم يبدأ الصوت. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | The sound would not start even after the user's click. |
| `failure_updated` | nomusic was updated or turned off. Reload the page to continue. | <div dir="rtl">تم تحديث nomusic أو إيقافه. أعد تحميل الصفحة للمتابعة.</div> | Shown after the extension was updated or removed; chrome.i18n is gone by then, so the text is resolved at load. |
| `setup_heading` | Watch YouTube without the music | <div dir="rtl">شاهد YouTube بدون موسيقى</div> | Heading of the first-run page: what the user gets. An imperative, as the English (شاهد). |
| `consent_text` | To remove most of the music, nomusic reads the sound of the YouTube videos you play, on this computer only. It never uploads or saves the sound. Its setting may sync through Chrome Sync. | <div dir="rtl">لإزالة معظم الموسيقى، يقرأ nomusic صوت فيديوهات YouTube التي تشاهدها ويعالجه على هذا الحاسوب فقط. ولا يرسل الصوت إلى أي مكان ولا يحفظه، وقد يتزامن إعداده عبر Chrome Sync.</div> | The disclosure (Chrome Web Store user-data policy), on the first-run page and in the popup before the first run; the privacy policy link follows it. Must keep every fact: reads the videos' sound, processed on this computer only, never sent anywhere or saved, its setting may sync through Chrome Sync. يرسل, not يرفع (which also means "turn up" the sound); على هذا الحاسوب فقط follows ويعالجه so that it qualifies the processing. فيديوهات and YouTube, and Chrome Sync, are joined by no-break spaces. |
| `consent_accept` | Turn on | <div dir="rtl">تفعيل</div> | The one button of the disclosure: the user's affirmative consent. تفعيل, as Chrome's Arabic says "Turn on" (تشغيل would read as "Play" next to YouTube). |
| `done_heading` | nomusic is on | <div dir="rtl">تم تفعيل nomusic</div> | First-run page after the choice, in Chrome's "[name] is on" pattern (تم تفعيل, matching the تفعيل button). Also the title of the dialog on a video that was already playing when the user turned nomusic on (`failure_missed`). |
| `done_wait` | Each video waits a few seconds as it starts, while the music is removed. | <div dir="rtl">ينتظر كل فيديو بضع ثوانٍ عند بدايته، ريثما تُزال الموسيقى.</div> | First-run page after the choice: prepares the user for the pause at every video's start. |
| `done_control` | To play one with its music, use {icon} in the player. | <div dir="rtl">لتشغيل فيديو مع موسيقاه، استخدم {icon} في المشغّل.</div> | First-run page after the choice. {icon} is the player button's struck note, shown in the sentence; keep the token where the sentence needs the picture. |
| `done_text` | If a YouTube tab was already open, reload it. | <div dir="rtl">إن كانت علامة تبويب YouTube مفتوحة من قبل، فأعد تحميلها.</div> | Tabs opened before nomusic was turned on need a reload (content scripts load only on navigation, and nomusic has no permission to reload tabs). Most users have none, so the condition comes first; the instruction is an imperative. |
| `done_open` | Open YouTube | <div dir="rtl">فتح YouTube</div> | Button that opens youtube.com in the same tab (verbal noun فتح). |
| `done_back` | Back to the video | <div dir="rtl">العودة إلى الفيديو</div> | Button instead of "Open YouTube" when the page was opened from a video's button: goes back to that tab and reloads it where the video was (verbal noun العودة). |
| `popup_autostart_label` | Remove music from every video | <div dir="rtl">إزالة الموسيقى من كل فيديو</div> | Name of the one switch; before the first run, turning it on is the consent. A setting name, so a noun phrase. |
| `popup_one_video` | To remove the music from one video, use {icon} in the player. | <div dir="rtl">لإزالة الموسيقى من فيديو واحد، استخدم {icon} في المشغّل.</div> | Under the popup's switch while it is off. {icon} is the player button's note, shown in the sentence; keep the token. |
| `link_help` | Help | <div dir="rtl">مساعدة</div> | Link to the help (how nomusic works, what to do); reporting a problem is one link further. مساعدة without the article, as Google's menus. |
| `link_help_url` | https://github.com/IbraheemTuffaha/nomusic#using-nomusic | <div dir="rtl">https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/help.ar.md</div> | Not translated as text: the address of the help in this language (README's "Using nomusic" in English, docs/help.ar.md in Arabic). |
| `link_privacy` | Privacy policy | <div dir="rtl">سياسة الخصوصية</div> | The published privacy policy. |
