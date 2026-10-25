# Translations

Every user-visible string of the extension lives in `extension/_locales/en/messages.json`
(English, the default) and `extension/_locales/ar/messages.json` (Arabic). Chrome picks the
language from the browser's UI language and falls back to English per message. This table
is for review by a native speaker; the Arabic is Modern Standard Arabic, plain and short.

Conventions
- The brand "nomusic" and product names (Chrome Sync, Chrome, Edge, Brave, Chromium, YouTube
  except in running Arabic text) stay in Latin letters.
- "voices" (speech and singing) = الأصوات البشرية; "sound" (the video's audio) = الصوت; "music" =
  الموسيقى; "musical instruments" = الآلات الموسيقية.
- Button labels use the verbal noun (مصدر) like Chrome's own Arabic UI; states use the passive
  past (أُزيلت الموسيقى); instructions use the imperative (انقر).
- Quotation marks around button names are “…” in English and «…» in Arabic; `$LABEL$` is
  filled at run time with the button's current label, so the names always match.
- Numbers use Western digits.

| Key | English | Arabic | Notes |
|---|---|---|---|
| `extension_name` | nomusic | <div dir="rtl">nomusic</div> | Brand; never translated or transliterated. |
| `extension_description` | Removes most of the background music from YouTube videos and keeps the voices. Runs on your computer; nothing is uploaded. | <div dir="rtl">يزيل معظم الموسيقى الخلفية من مقاطع يوتيوب ويُبقي الأصوات البشرية. يعمل على جهازك، ولا يُرفع أي شيء.</div> | Store summary (132 characters at most). "Voices" = الأصوات البشرية to keep it apart from "sound" (صوت). |
| `button_setup` | Set up nomusic | <div dir="rtl">إعداد nomusic</div> | Shown before the first-run consent. Verbal noun (مصدر) like Chrome's own buttons. |
| `button_setup_title` | nomusic needs a quick setup before it can remove music. Click to open it. | <div dir="rtl">يحتاج nomusic إلى إعداد سريع قبل أن يزيل الموسيقى. انقر لفتحه.</div> |  |
| `button_off` | Remove music | <div dir="rtl">إزالة الموسيقى</div> | Imperative sense: clicking starts nomusic. Verbal noun form. |
| `button_off_title` | Remove the music from this video | <div dir="rtl">إزالة الموسيقى من هذا الفيديو</div> |  |
| `button_starting` | Removing music… | <div dir="rtl">جارٍ إزالة الموسيقى…</div> | Progress label; use the ellipsis character (…). Same text as button_buffering on purpose (one label while the video waits). |
| `button_starting_title` | nomusic is getting the sound ready. The video continues in a moment. | <div dir="rtl">يُجهّز nomusic الصوت. يتابع الفيديو خلال لحظات.</div> |  |
| `button_buffering` | Removing music… | <div dir="rtl">جارٍ إزالة الموسيقى…</div> | Same visible text as button_starting; only the tooltip differs. |
| `button_buffering_title` | nomusic is getting the next part ready. The video continues in a moment. | <div dir="rtl">يُجهّز nomusic الجزء التالي. يتابع الفيديو خلال لحظات.</div> |  |
| `button_on` | Music removed | <div dir="rtl">أُزيلت الموسيقى</div> | A state, not a command: passive past (أُزيلت), unlike button_off. |
| `button_on_title` | Most of the music is removed. Click to play this video with its music. | <div dir="rtl">أُزيل معظم الموسيقى. انقر لتشغيل هذا الفيديو بموسيقاه.</div> | "Most of the music" is deliberate (some music can remain). |
| `button_blocked` | Click to start the sound | <div dir="rtl">انقر لتشغيل الصوت</div> | "Sound" = the video's audio in general, not voices. Imperative: it tells the user what to do. |
| `button_blocked_title` | Your browser needs a click before it plays sound. Click here or on the video. | <div dir="rtl">يحتاج المتصفح إلى نقرة قبل تشغيل الصوت. انقر هنا أو على الفيديو.</div> |  |
| `button_failed` | Music not removed | <div dir="rtl">لم تُزَل الموسيقى</div> | A state: passive past, negated. |
| `button_failed_title` | nomusic couldn't remove the music. Click to choose what to do. | <div dir="rtl">لم يستطع nomusic إزالة الموسيقى. انقر لاختيار ما تريد.</div> |  |
| `panel_note` | The video stays paused and silent until you choose. | <div dir="rtl">يبقى الفيديو متوقفًا وصامتًا حتى تختار.</div> | Second line of the failure panel. |
| `panel_retry` | Try again | <div dir="rtl">إعادة المحاولة</div> | Button, ≤ ~14 characters wide; verbal noun as in Chrome's Arabic UI. |
| `panel_reload` | Reload page | <div dir="rtl">إعادة تحميل الصفحة</div> | Button; replaces panel_retry when a reload is the fix. |
| `panel_original` | Play with music | <div dir="rtl">التشغيل مع الموسيقى</div> | Button. Must be unmistakable that music will play; avoid a soft "original". |
| `failure_protected` | This video is copy-protected, so nomusic can't reach its sound. | <div dir="rtl">هذا الفيديو محمي من النسخ، لذا لا يستطيع nomusic الوصول إلى صوته.</div> | "Copy-protected" = the owner locked the video, as rented movies are. |
| `failure_codec` | nomusic can't read this video's sound format. | <div dir="rtl">لا يستطيع nomusic قراءة صيغة الصوت في هذا الفيديو.</div> | "Sound format" rather than a technical "codec". |
| `failure_uncaptured` | nomusic couldn't reach this video's sound. Reloading the page usually fixes this. | <div dir="rtl">لم يستطع nomusic الوصول إلى صوت هذا الفيديو. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | Second sentence tells the fix (the button then says Reload page). |
| `failure_source` | nomusic can't reach this player's sound. | <div dir="rtl">لا يستطيع nomusic الوصول إلى صوت هذا المشغّل.</div> |  |
| `failure_slow` | Removing the music is taking too long. Your computer may be busy right now. | <div dir="rtl">إزالة الموسيقى تستغرق وقتًا طويلًا. قد يكون جهازك مشغولًا الآن.</div> | Second sentence gives the likely cause. |
| `failure_engine` | nomusic couldn't start. Reloading the page usually fixes this. | <div dir="rtl">لم يستطع nomusic البدء. إعادة تحميل الصفحة تحلّ المشكلة عادةً.</div> | The button then says Reload page. |
| `failure_error` | Something went wrong while removing the music. | <div dir="rtl">حدث خطأ أثناء إزالة الموسيقى.</div> |  |
| `failure_audio` | nomusic couldn't take over this video's sound. | <div dir="rtl">لم يستطع nomusic التحكم في صوت هذا الفيديو.</div> |  |
| `failure_updated` | nomusic was updated or turned off. Reload the page to continue. | <div dir="rtl">تم تحديث nomusic أو إيقافه. أعد تحميل الصفحة للمتابعة.</div> | Shown after the extension was updated or removed; chrome.i18n is gone by then, so the text is resolved at load. |
| `consent_heading` | Turn on music removal | <div dir="rtl">تشغيل إزالة الموسيقى</div> | Heading of the first-run disclosure card. |
| `consent_text` | nomusic reads the sound that YouTube has already loaded, removes most of the music on this computer, and plays the voices in its place. Audio is never uploaded or saved as a file. Your setting may sync through Chrome Sync. | <div dir="rtl">يقرأ nomusic الصوت الذي حمّله يوتيوب مسبقًا، ويزيل معظم الموسيقى على هذا الجهاز، ويشغّل الأصوات البشرية بدلًا منه. لا يُرفع الصوت أبدًا ولا يُحفظ كملف. قد يُزامَن إعدادك عبر Chrome Sync.</div> | First-run disclosure (Chrome Web Store user-data policy). Must mention: reads already-loaded audio, local processing, voices played instead, never uploaded or saved as a file, setting may sync. |
| `consent_accept` | Turn on nomusic | <div dir="rtl">تشغيل nomusic</div> | Primary button of the disclosure; same wording as the popup. |
| `consent_later` | Not now | <div dir="rtl">ليس الآن</div> | Secondary button: defers, nomusic stays off. |
| `consent_done` | nomusic is on. Reload any YouTube tabs that were already open. | <div dir="rtl">nomusic يعمل الآن. أعد تحميل علامات تبويب يوتيوب التي كانت مفتوحة من قبل.</div> | After consent. Tabs open before the install need a reload (content scripts only load on navigation). |
| `consent_later_done` | nomusic stays off. Turn it on any time from the nomusic icon in the browser toolbar. | <div dir="rtl">يبقى nomusic متوقفًا. يمكنك تشغيله في أي وقت من أيقونة nomusic في شريط أدوات المتصفح.</div> | After "Not now". |
| `popup_autostart_label` | Remove music from every video | <div dir="rtl">إزالة الموسيقى من كل فيديو</div> | Name of the one switch (its hint is linked with aria-describedby). |
| `popup_autostart_hint` | Every YouTube video starts with its music removed. When this is off, click “$LABEL$” on a video to start. | <div dir="rtl">يبدأ كل فيديو على يوتيوب وموسيقاه مُزالة. عند إيقاف هذا الخيار، انقر «$LABEL$» على الفيديو للبدء.</div> | $LABEL$ is button_off, inserted at run time, in quotes («» in Arabic). |
| `popup_autostart_note` | Videos already playing keep going until you click the button on them. | <div dir="rtl">الفيديوهات التي تعمل الآن تستمر كما هي حتى تنقر الزر عليها.</div> | Turning the switch off never interrupts a video already playing. |
| `popup_results` | Voices stay, including speech and singing. Musical instruments are removed, though some quiet music can remain. | <div dir="rtl">تبقى الأصوات البشرية، كلامًا وغناءً. تُزال الآلات الموسيقية، وقد يبقى بعض الموسيقى الخفيفة.</div> | Results statement: voices stay, instruments (آلات موسيقية) removed, some quiet music can remain. Honest wording per the store policy. |
| `privacy_summary` | Audio is processed on this computer and is never uploaded. Your automatic-removal setting may sync through Chrome Sync. No analytics or tracking. | <div dir="rtl">يُعالَج الصوت على هذا الجهاز ولا يُرفع أبدًا. قد يُزامَن إعداد الإزالة التلقائية عبر Chrome Sync. لا تحليلات ولا تتبّع.</div> | Exact privacy line from the store kit; used in the popup and on the welcome page. "Chrome Sync" stays in Latin letters (product name). |
| `link_guide` | Guide | <div dir="rtl">الدليل</div> | Opens the welcome page. |
| `link_help` | Help and feedback | <div dir="rtl">المساعدة والملاحظات</div> | GitHub issues. |
| `link_licenses` | Licenses | <div dir="rtl">التراخيص</div> | Third-party notices. |
| `link_privacy` | Privacy policy | <div dir="rtl">سياسة الخصوصية</div> | The published privacy policy. |
| `welcome_title` | Welcome to nomusic | <div dir="rtl">مرحبًا بك في nomusic</div> | Page title and heading. |
| `welcome_how` | How it works | <div dir="rtl">كيف يعمل</div> |  |
| `welcome_step_play` | Play a YouTube video. Most of the music is removed by itself. The video pauses for a few seconds at the start, and after you jump to a new part, while nomusic gets the sound ready. | <div dir="rtl">شغّل فيديو على يوتيوب. تُزال معظم الموسيقى تلقائيًا. يتوقف الفيديو بضع ثوانٍ في البداية، وبعد الانتقال إلى جزء جديد، بينما يُجهّز nomusic الصوت.</div> | Explains the pause at the start and after a jump before the user sees it. |
| `welcome_step_button` | The “$LABEL$” button in the corner of the video turns nomusic off for that video, so it plays with its music, and on again. The button shows while the video's controls are showing. | <div dir="rtl">زر «$LABEL$» في زاوية الفيديو يوقف nomusic لذلك الفيديو فيُشغَّل بموسيقاه، ثم يعيد تشغيله. يظهر الزر عندما تظهر أزرار التحكم في الفيديو.</div> | $LABEL$ is button_on. Says plainly that turning it off plays the music. |
| `welcome_step_toolbar` | The nomusic icon in the browser toolbar has one setting: remove music from every video, or only when you click. | <div dir="rtl">لأيقونة nomusic في شريط أدوات المتصفح إعداد واحد: إزالة الموسيقى من كل فيديو، أو عند النقر فقط.</div> | The toolbar icon has one setting. |
| `welcome_expect` | What to expect | <div dir="rtl">ما الذي تتوقعه</div> |  |
| `welcome_expect_voices` | Voices stay, including speech and singing. Musical instruments are removed. Some quiet music can remain, most often under speech. | <div dir="rtl">تبقى الأصوات البشرية، كلامًا وغناءً. تُزال الآلات الموسيقية. قد يبقى بعض الموسيقى الخفيفة، غالبًا تحت الكلام.</div> | Same terms as popup_results. |
| `welcome_expect_fail` | If nomusic can't remove the music, the video stays paused and silent, and nomusic asks whether to try again or play with music. | <div dir="rtl">إذا لم يستطع nomusic إزالة الموسيقى، يبقى الفيديو متوقفًا وصامتًا، ويسألك nomusic إن كنت تريد إعادة المحاولة أو التشغيل مع الموسيقى.</div> | Describes the failure panel; "try again" / "play with music" mirror panel_retry / panel_original. |
| `welcome_limits` | Limits | <div dir="rtl">الحدود</div> |  |
| `welcome_limit_desktop` | Works on YouTube in Chrome, Edge, Brave and other Chromium browsers on a computer. Not on phones. | <div dir="rtl">يعمل على يوتيوب في Chrome وEdge وBrave وغيرها من متصفحات Chromium على الحاسوب، لا على الهواتف.</div> | Browser names stay in Latin letters. |
| `welcome_limit_protected` | Copy-protected videos, such as rented movies, can't be processed. | <div dir="rtl">لا يمكن معالجة الفيديوهات المحمية من النسخ، مثل الأفلام المستأجرة.</div> |  |
| `welcome_limit_live` | A live stream watched right at its live point keeps pausing. A little behind it plays smoothly. | <div dir="rtl">البث المباشر عند نقطة البث الحيّ يتوقف باستمرار. والمشاهدة بتأخير قليل تعمل بسلاسة.</div> | Live streams: at the live point it keeps pausing; a little behind it plays smoothly. |
| `welcome_limit_memory` | While it works, nomusic uses about 450 MB of memory. | <div dir="rtl">يستخدم nomusic أثناء عمله نحو 450 ميغابايت من الذاكرة.</div> | Number stays in Western digits, as in Chrome's Arabic UI. |
