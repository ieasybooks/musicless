# قائمة المتجر بالعربية

**Needs native review.** This is Modern Standard Arabic for the Chrome Web
Store Arabic locale. It states the same features, limits, and privacy claims
as [store-listing.md](store-listing.md). Do not submit it until a native
speaker has reviewed it. Keep the Latin name `nomusic`. Reviewer-only
permission answers stay in the English file.

The summary is the manifest `description` from
`extension/_locales/ar/messages.json`, so the package supplies it; keep the
two identical. It must stay at or under 132 characters on its own. Recount
after any edit.

## الاسم

```text
nomusic
```

## الملخص

93 of 132 characters.

```text
يزيل معظم موسيقى الخلفية من فيديوهات YouTube™ ويُبقي الأصوات البشرية. يعمل كل شيء على حاسوبك.
```

## الوصف

```text
يخفّض nomusic موسيقى الخلفية ويُبقي الأصوات البشرية: الكلام والغناء. متوافق مع YouTube™. صُنع لمن يريد تجنّب الموسيقى لأسباب دينية أو شخصية، ولمن يفضّل الأصوات البشرية مع موسيقى خلفية أقل.

كيف يعمل
• يجري فصل الصوت على حاسوبك باستخدام نموذج مفتوح المصدر مضمّن في الإضافة. لا حاجة إلى حساب ولا إلى خدمة خلفية.
• بعد اختيار «تشغيل» تكون الإزالة التلقائية مفعّلة افتراضيًا. أوقفها من شريط الأدوات إذا أردت اختيار الفيديوهات واحدًا واحدًا.
• قد ينتظر الفيديو لحظةً في البداية أو بعد الانتقال إلى موضع آخر فيه، بينما يُجهَّز الصوت بعد إزالة الموسيقى منه. تظهر في وسط الفيديو أثناء ذلك دائرة انتظار وعبارة «جارٍ إزالة الموسيقى».
• يقع زر nomusic في شريط عناصر التحكم في المشغّل، بجانب زر الترجمة: نوتة موسيقية يشطبها خط أثناء إزالة الموسيقى. انقره لتشغيل الفيديو مع موسيقاه، وانقره مرة أخرى لإزالة الموسيقى.

عناصر التحكم في التشغيل
يمكن ضبط مستوى الصوت وكتمه، والانتقال إلى موضع آخر في الفيديو، واستخدام ملء الشاشة، وتغيير سرعة التشغيل. يعمل nomusic أيضًا مع المقاطع القصيرة (Shorts) والبث المباشر والمشغّلات المضمّنة المدعومة على الحاسوب.

الخصوصية
يقرأ nomusic الصوت الذي حمّله مشغّل الموقع أصلًا ويعالجه في ذاكرة المتصفح لإزالة الموسيقى فقط. لا يُرفَع الصوت أبدًا ولا يُشارَك ولا يُحفَظ ملفًا. لا يوفّر تنزيل وسائط ولا تسجيلًا ولا تصدير صوت. لا يتلقى المطوّر الصوت ولا سجل التصفح ولا تحليلات الاستخدام. يُحفَظ إعداد الإزالة التلقائية، وما إذا كنت قد شغّلت nomusic، في مساحة تخزين إضافات Chrome، وقد يتزامنان بين أجهزتك عبر Chrome Sync. ويبقى على هذا الحاسوب رمز عشوائي يجعل إطار المعالجة في nomusic لا يقبل الاتصال إلا من nomusic نفسه.

قيود ينبغي معرفتها
• قد يبقى بعض الموسيقى، خصوصًا موسيقى الخلفية الخافتة أثناء الكلام. قد تفقد الأصوات البشرية بعض بريقها. هذا ليس ضمانًا لتشغيل خالٍ من الموسيقى.
• تستخدم المعالجة مسار تنفيذ واحدًا في المعالج ونحو 400 ميغابايت من الذاكرة، ويختلف الأداء باختلاف الحاسوب والفيديو.
• لا يمكن معالجة الفيديوهات المحمية من النسخ. عند فشل الإزالة يتوقف الفيديو ويبقى الصوت الأصلي صامتًا، وتظهر رسالة «تعذّرت إزالة الموسيقى» مع خياري «إعادة المحاولة» و«تشغيل مع الموسيقى». بعض حالات الفشل تعرض «إعادة تحميل الصفحة» بدلًا من ذلك. إذا كان المتصفح ينتظر نقرة قبل تشغيل الصوت، يظهر زر تشغيل في وسط الفيديو.
• يتوقف البث المباشر مرارًا إذا شاهدته عند أحدث نقطة وصل إليها. وتقلّ هذه التوقفات عند المشاهدة بتأخير قليل عن تلك النقطة.
• تدعم الإضافة مشغّلات الموقع على الحاسوب، لا متصفحات الهاتف ولا خدمات فيديو أخرى.

مجانية ومفتوحة المصدر. الشفرة البرمجية والمساعدة: https://github.com/IbraheemTuffaha/nomusic
سياسة الخصوصية: https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md

nomusic مشروع مستقل، وهو غير تابع لـ YouTube أو Google ولا يحظى بتأييدهما. YouTube علامة تجارية لـ Google LLC. يخضع استخدام هذه العلامة لشروط Google Permissions.
```

## ألفاظ الواجهة

These are the player and first-run strings the description uses. The
extension UI uses the same Arabic (they come from
`extension/_locales/ar/messages.json`).

| English | Arabic |
| --- | --- |
| Turn on | تشغيل |
| Remove music | إزالة الموسيقى |
| Play with music | تشغيل مع الموسيقى |
| Removing music | جارٍ إزالة الموسيقى |
| Couldn't remove the music | تعذّرت إزالة الموسيقى |
| Try again | إعادة المحاولة |
| Reload page | إعادة تحميل الصفحة |

Buttons use the verbal noun, as Chrome's and YouTube's own Arabic buttons do
(the earlier imperatives شغّل، حاول مجددًا، أعد تحميل الصفحة were changed in
the design pass; the native review should confirm). «تشغيل مع الموسيقى» means
the video's music will play. Do not soften it to "original". «جارٍ إزالة
الموسيقى» is the progress line. The voices in the description are
«الأصوات البشرية: الكلام والغناء»: speech and singing, both. Where removal is
described, it removes the sounds of the instruments, «أصوات الآلات الموسيقية»;
the instruments themselves are «الآلات الموسيقية».

## الصور

The Arabic screenshots are `docs/store/ar-1-music-removed.png`,
`ar-2-turn-on-once.png`, `ar-3-you-choose.png` and `ar-4-one-setting.png`,
captured on Arabic YouTube (`hl=ar`) with the Arabic catalog; upload them with
the Arabic locale. The promo tile and the store icon are shared with English.
Their captions:

| File | Caption |
| --- | --- |
| `ar-1-music-removed.png` | يزيل معظم الموسيقى. ويُبقي الأصوات البشرية. |
| `ar-2-turn-on-once.png` | شغّله مرة واحدة. بعد ذلك يعمل تلقائيًا. |
| `ar-3-you-choose.png` | إذا لم يستطع إزالة الموسيقى، تختار أنت ما يُشغَّل. |
| `ar-4-one-setting.png` | إعداد واحد. ولا يغادر الصوت حاسوبك أبدًا. |
