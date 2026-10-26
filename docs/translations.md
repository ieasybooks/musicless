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
- Buttons use the verbal noun, as Chrome's and YouTube's own Arabic buttons do (تفعيل،
  إعادة المحاولة، إعادة تحميل الصفحة، تشغيل مع الموسيقى، إيقاف إزالة الموسيقى، فتح YouTube); "Turn
  on" is تفعيل, as in Chrome, since تشغيل means "Play" beside a video. Headings, feature and
  setting names are noun phrases too (مشاهدة YouTube بدون موسيقى، إزالة الموسيقى من
  كل فيديو). Instructions in sentences use the imperative (استخدم، أعد تحميل). Progress is جارٍ
  إزالة الموسيقى, the failure state لم تُزَل الموسيقى, the enabled state تم تفعيل nomusic. (Until
  this pass the buttons were imperatives, حاول مجددًا and شغّل nomusic; the native review
  should confirm the change.)
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
| `control_setup` | Turn on nomusic | <div dir="rtl">تفعيل nomusic</div> | Tooltip and name of the player button before the first run; it opens the first-run page. On YouTube's page the brand names what will be turned on; تفعيل as on the first-run button. |
| `control_failed` | Music not removed | <div dir="rtl">لم تُزَل الموسيقى</div> | Tooltip and name of the player button after a failure whose dialog was closed; a click opens it again. Failure state: لم تُزَل. |
| `notice_working` | Removing music | <div dir="rtl">جارٍ إزالة الموسيقى</div> | Under a spinner in the middle of the video while it waits a moment for the first audio without music (at the start, or after a jump). جارٍ …, as Google's Arabic shows progress. |
| `notice_blocked` | Click to play | <div dir="rtl">انقر للتشغيل</div> | The name of the round play button in the middle of the video when the browser needs a click before it plays sound (read by screen readers; the button shows only the play sign). |
| `panel_title` | Couldn’t remove the music | <div dir="rtl">تعذّرت إزالة الموسيقى</div> | Title of the failure dialog; the reason follows it. تعذّرت = could not be done (no blame). |
| `panel_retry` | Try again | <div dir="rtl">إعادة المحاولة</div> | Failure dialog action. Buttons use the verbal noun, as Chrome's and YouTube's Arabic do (إعادة المحاولة). |
| `panel_reload` | Reload page | <div dir="rtl">إعادة تحميل الصفحة</div> | Failure dialog action when only a fresh page can help. إعادة تحميل, never تحديث (that would read as updating the extension). |
| `panel_original` | Play with music | <div dir="rtl">تشغيل مع الموسيقى</div> | Failure dialog action that plays the video with its music. Must say "music" plainly; never "original". |
| `failure_protected` | This video is copy-protected. | <div dir="rtl">هذا الفيديو محمي من النسخ.</div> | Copy-protected = محمي من النسخ (the owner locked the video, as rented movies are). The dialog's title already says the music could not be removed. |
| `failure_codec` | This video’s sound format isn’t supported. | <div dir="rtl">صيغة الصوت في هذا الفيديو غير مدعومة.</div> |  |
| `failure_uncaptured` | Reloading the page usually fixes this. | <div dir="rtl">إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | Most often a video that was already playing when the user turned nomusic on: a reload is all it needs. The action is "Reload page". |
| `failure_source` | This player’s sound can’t be reached. | <div dir="rtl">لا يمكن الوصول إلى صوت هذا المشغّل.</div> |  |
| `failure_slow` | It’s taking too long. Your computer may be busy. | <div dir="rtl">تستغرق الإزالة وقتًا طويلًا. قد يكون حاسوبك مشغولًا.</div> | Keeps the uncertainty: قد (may). |
| `failure_engine` | Reloading the page usually fixes this. | <div dir="rtl">إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> |  |
| `failure_error` | Something went wrong. | <div dir="rtl">حدث خطأ ما.</div> | The cause is unknown; the two actions follow. |
| `failure_audio` | The sound didn’t start. Reloading the page usually fixes this. | <div dir="rtl">لم يبدأ الصوت. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | The sound would not start even after the user's click. |
| `failure_updated` | nomusic was updated or turned off. Reload the page to continue. | <div dir="rtl">تم تحديث nomusic أو إيقافه. أعد تحميل الصفحة للمتابعة.</div> | Shown after the extension was updated or removed; chrome.i18n is gone by then, so the text is resolved at load. |
| `setup_heading` | Watch YouTube without the music | <div dir="rtl">مشاهدة YouTube بدون موسيقى</div> | Heading of the first-run page: what the user gets. A noun phrase (مشاهدة). |
| `consent_text` | On this computer only, nomusic reads the sound of the YouTube videos you play, without uploading or saving it. Chrome may sync your settings. | <div dir="rtl">على هذا الحاسوب فقط، يقرأ nomusic صوت فيديوهات YouTube التي تشاهدها، دون أن يرفعه أو يحفظه. وقد يزامن Chrome إعداداتك.</div> | The disclosure (Chrome Web Store user-data policy), on the first-run page and in the popup; the privacy policy link follows it. Must keep every fact: on this computer only, reads the videos' sound, never uploads or saves it, settings may sync (Chrome Sync, named as Chrome). فيديوهات and YouTube are joined by a no-break space. |
| `consent_accept` | Turn on | <div dir="rtl">تفعيل</div> | The one button of the disclosure: the user's affirmative consent. تفعيل, as Chrome's Arabic says "Turn on" (تشغيل would read as "Play" next to YouTube). |
| `done_heading` | nomusic is on | <div dir="rtl">تم تفعيل nomusic</div> | First-run page after the choice, in Chrome's "[name] is on" pattern (تم تفعيل, matching the تفعيل button). |
| `done_text` | If a YouTube tab was already open, reload it. | <div dir="rtl">إن كانت علامة تبويب YouTube مفتوحة من قبل، فأعد تحميلها.</div> | Tabs opened before nomusic was turned on need a reload (content scripts load only on navigation, and nomusic has no permission to reload tabs). Most users have none, so the condition comes first; the instruction is an imperative. |
| `done_open` | Open YouTube | <div dir="rtl">فتح YouTube</div> | Button that opens youtube.com in the same tab (verbal noun فتح). |
| `popup_autostart_label` | Remove music from every video | <div dir="rtl">إزالة الموسيقى من كل فيديو</div> | Name of the one switch, and the popup's title before the first run; a setting name, so a noun phrase. |
| `popup_autostart_hint` | Use the button in the player to turn it on for one video. | <div dir="rtl">استخدم الزر في المشغّل لتفعيله لفيديو واحد.</div> | Under the switch, only while it is off: the other way to use nomusic, the button in the player, for one video at a time. |
| `link_help` | Help | <div dir="rtl">مساعدة</div> | GitHub issues. مساعدة without the article, as Google's menus. |
| `link_privacy` | Privacy policy | <div dir="rtl">سياسة الخصوصية</div> | The published privacy policy. |
