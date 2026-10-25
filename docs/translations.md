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
- Action buttons use short imperatives (أزِل الموسيقى، حاول مجددًا، أعد تحميل الصفحة،
  شغّل مع الموسيقى، شغّل nomusic). Navigation labels and headings may be nouns (إعداد
  nomusic، تشغيل ميزة إزالة الموسيقى); setting labels stay noun phrases (إزالة الموسيقى من
  كل فيديو). Progress is تُزال الموسيقى…, the completed state أُزيلت الموسيقى, the failure
  state لم تُزَل الموسيقى. Instructions use the imperative (انقر).
- Quotation marks around button names are “…” in English and «…» in Arabic; `$LABEL$` is
  filled at run time with the button's current label, so the names always match.
- Western digits; the ellipsis character … (U+2026) for progress; the Arabic comma ، in Arabic
  text. Latin tokens (nomusic, Chrome Sync, 400) keep their logical order inside right-to-left
  text; isolate a mixed run in the renderer where a visual check needs it (the popup's version
  uses `<bdi>`). Character counts include combining marks and are not rendered widths.

| Key | English | Arabic | Notes |
|---|---|---|---|
| `locale_code` | en | <div dir="rtl">ar</div> | Not translated: the catalog's language code, used for the lang attribute. |
| `locale_dir` | ltr | <div dir="rtl">rtl</div> | Not translated: the catalog's writing direction. Pages and the in-player UI take their direction from it. |
| `extension_name` | nomusic | <div dir="rtl">nomusic</div> | Brand; never translated or transliterated. |
| `extension_description` | Removes most of the background music from YouTube™ videos and keeps the voices. Runs on your computer; nothing is uploaded. | <div dir="rtl">يزيل معظم موسيقى الخلفية من مقاطع YouTube™ ويُبقي الأصوات البشرية. يعمل على حاسوبك، ولا يُرفع أي شيء.</div> | The store summary (132 characters at most; the Chrome Web Store takes it from the package). "Voices" = الأصوات البشرية to keep it apart from "sound" (صوت). Latin YouTube™ in both. |
| `button_setup` | Set up nomusic | <div dir="rtl">إعداد nomusic</div> | Shown before the first-run choice. A navigation label (it opens the setup page), so a noun phrase. |
| `button_setup_title` | nomusic needs a quick setup before it can remove music. Click to open it. | <div dir="rtl">يحتاج nomusic إلى إعداد سريع قبل أن يزيل الموسيقى. انقر لفتح صفحة الإعداد.</div> | Names what opens: the setup page (لفتح صفحة الإعداد). |
| `button_off` | Remove music | <div dir="rtl">أزِل الموسيقى</div> | Action button: short imperative (أزِل). Clicking starts nomusic. |
| `button_off_title` | Remove the music from this video | <div dir="rtl">أزِل الموسيقى من هذا الفيديو</div> | Same imperative as button_off. |
| `button_starting` | Removing music… | <div dir="rtl">تُزال الموسيقى…</div> | Progress label: present passive (تُزال) with the ellipsis character (…). Same text as button_buffering on purpose (one label while the video waits). |
| `button_starting_title` | nomusic is getting the sound ready. The video continues in a moment. | <div dir="rtl">يُجهّز nomusic الصوت. سيُستأنف الفيديو بعد لحظات.</div> | سيُستأنف: playback resumes. |
| `button_buffering` | Removing music… | <div dir="rtl">تُزال الموسيقى…</div> | Same visible text as button_starting; only the tooltip differs. |
| `button_buffering_title` | nomusic is getting the next part ready. The video continues in a moment. | <div dir="rtl">يُجهّز nomusic الجزء التالي. سيُستأنف الفيديو بعد لحظات.</div> |  |
| `button_on` | Music removed | <div dir="rtl">أُزيلت الموسيقى</div> | A state, not a command: passive past (أُزيلت), unlike the imperative button_off. |
| `button_on_title` | Most of the music is removed. Click to play this video with its music. | <div dir="rtl">أُزيل معظم الموسيقى. انقر لتشغيل هذا الفيديو بموسيقاه.</div> | "Most of the music" is deliberate (some music can remain); masculine أُزيل agrees with معظم. |
| `button_blocked` | Click to start the sound | <div dir="rtl">انقر لتشغيل الصوت</div> | "Sound" = the video's audio in general, not voices. Imperative: it tells the user what to do. |
| `button_blocked_title` | Your browser needs a click before it plays sound. Click here or on the video. | <div dir="rtl">يحتاج المتصفح إلى نقرة قبل تشغيل الصوت. انقر هنا أو على الفيديو.</div> |  |
| `button_failed` | Music not removed | <div dir="rtl">لم تُزَل الموسيقى</div> | A failure state: لم + passive imperfect in the jussive (لم تُزَل), with past negative meaning. |
| `button_failed_title` | nomusic couldn't remove the music. Click to choose what to do. | <div dir="rtl">لم يستطع nomusic إزالة الموسيقى. انقر لاختيار ما تريد.</div> |  |
| `panel_note` | The video stays paused and silent until you choose. | <div dir="rtl">يبقى الفيديو متوقفًا وصامتًا حتى تختار.</div> | Second line of the failure panel. |
| `panel_retry` | Try again | <div dir="rtl">حاول مجددًا</div> | Action button, ≤ ~14 characters wide: short imperative (11 code points). |
| `panel_reload` | Reload page | <div dir="rtl">أعد تحميل الصفحة</div> | Action button, imperative; replaces panel_retry when a reload is the fix. |
| `panel_original` | Play with music | <div dir="rtl">شغّل مع الموسيقى</div> | Action button, imperative. Must be unmistakable that music will play; avoid a soft "original". |
| `failure_protected` | This video is copy-protected, so nomusic can't reach its sound. | <div dir="rtl">هذا الفيديو محمي من النسخ، لذا لا يستطيع nomusic الوصول إلى صوته.</div> | "Copy-protected" = the owner locked the video, as rented movies are. |
| `failure_codec` | nomusic can't read this video's sound format. | <div dir="rtl">لا يستطيع nomusic قراءة صيغة الصوت في هذا الفيديو.</div> | "Sound format" rather than a technical "codec". |
| `failure_uncaptured` | nomusic couldn't reach this video's sound. Reloading the page usually fixes this. | <div dir="rtl">لم يستطع nomusic الوصول إلى صوت هذا الفيديو. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | Second sentence tells the fix (the button then says Reload page). |
| `failure_source` | nomusic can't reach this player's sound. | <div dir="rtl">لا يستطيع nomusic الوصول إلى صوت هذا المشغّل.</div> |  |
| `failure_slow` | Removing the music is taking too long. Your computer may be busy right now. | <div dir="rtl">إزالة الموسيقى تستغرق وقتًا طويلًا. قد يكون حاسوبك مشغولًا الآن.</div> | Second sentence gives the likely cause. Computer = حاسوب throughout. |
| `failure_engine` | nomusic couldn't start. Reloading the page usually fixes this. | <div dir="rtl">لم يستطع nomusic البدء. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | The button then says Reload page. |
| `failure_error` | Something went wrong while removing the music. | <div dir="rtl">حدث خطأ أثناء إزالة الموسيقى.</div> |  |
| `failure_audio` | nomusic couldn't take over this video's sound. | <div dir="rtl">لم يستطع nomusic التحكم في صوت هذا الفيديو.</div> |  |
| `failure_updated` | nomusic was updated or turned off. Reload the page to continue. | <div dir="rtl">تم تحديث nomusic أو إيقافه. أعد تحميل الصفحة للمتابعة.</div> | Shown after the extension was updated or removed; chrome.i18n is gone by then, so the text is resolved at load. |
| `consent_heading` | Turn on music removal | <div dir="rtl">تشغيل ميزة إزالة الموسيقى</div> | Heading of the first-run disclosure card: a noun phrase (the button below is the action). |
| `consent_text` | nomusic reads the sound that YouTube has already loaded, removes most of the music on this computer, and plays the voices in its place. Audio is never uploaded or saved as a file. Your nomusic settings may sync through Chrome Sync. | <div dir="rtl">يقرأ nomusic الصوت الذي حمّله YouTube مسبقًا، ويزيل معظم الموسيقى على هذا الحاسوب، ويشغّل الأصوات البشرية بدلًا منه. لا يُرفع الصوت أبدًا ولا يُحفظ ملفًا. قد تُزامَن إعدادات nomusic عبر Chrome Sync.</div> | First-run disclosure (Chrome Web Store user-data policy). Must mention: reads already-loaded audio, local processing, voices played instead, never uploaded or saved as a file, settings may sync. |
| `consent_accept` | Turn on nomusic | <div dir="rtl">شغّل nomusic</div> | Primary button of the disclosure: the explicit enable action (imperative شغّل); same wording as the popup. |
| `consent_later` | Not now | <div dir="rtl">ليس الآن</div> | Secondary button: defers, nomusic stays off. |
| `consent_done` | nomusic is on. Reload any YouTube tabs that were already open. | <div dir="rtl">nomusic قيد التشغيل. أعد تحميل علامات تبويب YouTube التي كانت مفتوحة من قبل.</div> | After the choice; قيد التشغيل names the enabled state. Tabs open before the install need a reload (content scripts only load on navigation). |
| `consent_later_done` | nomusic stays off. Turn it on any time from the nomusic icon in the browser toolbar. | <div dir="rtl">يبقى nomusic متوقفًا. يمكنك تشغيله في أي وقت من أيقونة nomusic في شريط أدوات المتصفح.</div> | After "Not now". |
| `popup_autostart_label` | Remove music from every video | <div dir="rtl">إزالة الموسيقى من كل فيديو</div> | Name of the one switch (its hint is linked with aria-describedby); a setting name, so a noun phrase. |
| `popup_autostart_hint` | nomusic starts by itself on every YouTube video. When this is off, click “$LABEL$” on a video to start. | <div dir="rtl">يبدأ nomusic تلقائيًا مع كل فيديو على YouTube. عند إيقاف هذا الإعداد، انقر «$LABEL$» على الفيديو للبدء.</div> | $LABEL$ is button_off, inserted at run time, in quotes («» in Arabic). "By itself" = تلقائيًا, as in welcome_step_play. |
| `popup_autostart_note` | Videos already playing keep going until you click the button on them. | <div dir="rtl">الفيديوهات التي تعمل الآن تستمر كما هي حتى تنقر الزر عليها.</div> | Turning the switch off never interrupts a video already playing. |
| `popup_results` | Voices stay, including speech and singing. Instrument sounds are removed, though some quiet music can remain. | <div dir="rtl">تبقى الأصوات البشرية، بما فيها الكلام والغناء. تُزال أصوات الآلات الموسيقية، مع أن بعض الموسيقى الخافتة قد يبقى.</div> | Results statement: voices stay (speech and singing), the sounds of instruments (أصوات الآلات الموسيقية) are removed, some quiet (خافتة = low volume) music can remain. |
| `privacy_summary` | Audio is processed on this computer and is never uploaded. Your nomusic settings may sync through Chrome Sync. No analytics or tracking. | <div dir="rtl">يُعالَج الصوت على هذا الحاسوب ولا يُرفع أبدًا. قد تُزامَن إعدادات nomusic عبر Chrome Sync. لا تحليلات ولا تتبّع.</div> | The short privacy summary of the popup and the welcome page (the store listing has a longer, different privacy paragraph). "Chrome Sync" stays in Latin letters (product name). |
| `link_guide` | Guide | <div dir="rtl">الدليل</div> | Opens the welcome page. |
| `link_help` | Help and feedback | <div dir="rtl">المساعدة والملاحظات</div> | GitHub issues. |
| `link_licenses` | Licenses | <div dir="rtl">التراخيص</div> | Third-party notices. |
| `link_privacy` | Privacy policy | <div dir="rtl">سياسة الخصوصية</div> | The published privacy policy. |
| `welcome_title` | Welcome to nomusic | <div dir="rtl">مرحبًا بك في nomusic</div> | Page title and heading. |
| `welcome_how` | How it works | <div dir="rtl">كيف يعمل</div> |  |
| `welcome_step_play` | Play a YouTube video. Most of the music is removed by itself. The video pauses for a few seconds at the start, and after you jump to a new part, while nomusic gets the sound ready. | <div dir="rtl">شغّل فيديو على YouTube. يُزال معظم الموسيقى تلقائيًا. يتوقف الفيديو لبضع ثوانٍ في البداية وبعد الانتقال إلى جزء جديد، بينما يُجهّز nomusic الصوت.</div> | Explains the pause at the start and after a jump before the user sees it. Masculine يُزال agrees with معظم. |
| `welcome_step_button` | The “$LABEL$” button in the corner of the video turns nomusic off for that video, so it plays with its music, and on again. The button shows while the video's controls are showing. | <div dir="rtl">انقر زر «$LABEL$» في زاوية الفيديو لإيقاف nomusic لهذا الفيديو وتشغيله بموسيقاه، وانقر الزر مجددًا لتشغيل nomusic. يظهر الزر عندما تظهر عناصر التحكم في الفيديو.</div> | $LABEL$ is button_on. Says plainly that turning it off plays the music, and that turning it back on takes another click. |
| `welcome_step_toolbar` | The nomusic icon in the browser toolbar has one setting: remove music from every video, or only when you click. | <div dir="rtl">لأيقونة nomusic في شريط أدوات المتصفح إعداد واحد: إزالة الموسيقى من كل فيديو، أو عند النقر فقط.</div> | The toolbar icon has one setting. |
| `welcome_expect` | What to expect | <div dir="rtl">ما الذي تتوقعه</div> |  |
| `welcome_expect_voices` | Voices stay, including speech and singing. Instrument sounds are removed. Some quiet music can remain, most often under speech. | <div dir="rtl">تبقى الأصوات البشرية، بما فيها الكلام والغناء. تُزال أصوات الآلات الموسيقية. قد يبقى بعض الموسيقى الخافتة، غالبًا في خلفية الكلام.</div> | Same terms as popup_results. |
| `welcome_expect_fail` | If nomusic can't remove the music, the video stays paused and silent, and nomusic asks whether to try again or play with music. | <div dir="rtl">إذا لم يستطع nomusic إزالة الموسيقى، يبقى الفيديو متوقفًا وصامتًا، ويطلب منك nomusic الاختيار بين «حاول مجددًا» و«شغّل مع الموسيقى».</div> | Describes the failure panel; quotes panel_retry and panel_original verbatim. |
| `welcome_limits` | Limits | <div dir="rtl">القيود</div> | Heading; the listing uses the same word (قيود ينبغي معرفتها). |
| `welcome_limit_desktop` | Works on YouTube in Chrome, Edge, Brave and other Chromium browsers on a computer. Not on phones. | <div dir="rtl">يعمل على YouTube في Chrome وEdge وBrave وغيرها من متصفحات Chromium على الحاسوب، لا على الهواتف.</div> | Browser names stay in Latin letters. |
| `welcome_limit_protected` | Copy-protected videos, such as rented movies, can't be processed. | <div dir="rtl">لا يمكن معالجة الفيديوهات المحمية من النسخ، مثل الأفلام المستأجرة.</div> |  |
| `welcome_limit_live` | A live stream watched right at its live point keeps pausing. Watching a little behind it reduces the pauses. | <div dir="rtl">يتوقف البث المباشر مرارًا إذا شاهدته عند أحدث نقطة وصل إليها. وتقلّ هذه التوقفات عند المشاهدة بتأخير قليل عن تلك النقطة.</div> | Live streams: at the live point it keeps pausing; a little behind it, fewer pauses (no promise of smooth playback). |
| `welcome_limit_memory` | While it works, nomusic uses about 400 MB of memory. | <div dir="rtl">يستخدم nomusic أثناء عمله نحو 400 ميغابايت من الذاكرة.</div> | Number stays in Western digits. One figure everywhere: about 400 MB. |
