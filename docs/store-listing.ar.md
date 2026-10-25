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

101 of 132 characters.

```text
يزيل معظم موسيقى الخلفية من مقاطع YouTube™ ويُبقي الأصوات البشرية. يعمل على حاسوبك، ولا يُرفع أي شيء.
```

## الوصف

```text
يخفّض nomusic موسيقى الخلفية ويُبقي الأصوات البشرية: الكلام والغناء. متوافق مع YouTube™. صُنع لمن يريد تجنّب الموسيقى لأسباب دينية أو شخصية، ولمن يفضّل الأصوات البشرية مع موسيقى خلفية أقل.

كيف يعمل
• يجري فصل الصوت على حاسوبك باستخدام نموذج مفتوح المصدر مضمّن في الإضافة. لا حاجة إلى حساب ولا إلى خدمة خلفية.
• بعد اختيار «شغّل nomusic» تكون الإزالة التلقائية مفعّلة افتراضيًا. أوقفها من شريط الأدوات إذا أردت تشغيلها لكل فيديو على حدة.
• قد يتوقف الفيديو لحظةً في البداية أو بعد الانتقال إلى موضع آخر فيه، بينما يُجهَّز الصوت بعد إزالة الموسيقى منه. يقول الزر «تُزال الموسيقى…» أثناء ذلك.
• انقر «أُزيلت الموسيقى» في المشغّل لسماع الصوت الأصلي، ثم انقر «أزِل الموسيقى» لتشغيل ميزة إزالة الموسيقى مجددًا. قبل الاختيار الأول يقول الزر «إعداد nomusic».

عناصر التحكم في التشغيل
يمكن ضبط مستوى الصوت وكتمه، والانتقال إلى موضع آخر في الفيديو، واستخدام ملء الشاشة، وتغيير سرعة التشغيل. يعمل nomusic أيضًا مع المقاطع القصيرة (Shorts) والبث المباشر والمشغّلات المضمّنة المدعومة على الحاسوب.

الخصوصية
يقرأ nomusic الصوت الذي حمّله مشغّل الموقع أصلًا ويعالجه في ذاكرة المتصفح لإزالة الموسيقى فقط. لا يُرفَع الصوت أبدًا ولا يُشارَك ولا يُحفَظ ملفًا. لا يوفّر تنزيل وسائط ولا تسجيلًا ولا تصدير صوت. لا يتلقى المطوّر الصوت ولا سجل التصفح ولا تحليلات الاستخدام. يُحفَظ إعداد الإزالة التلقائية، وما إذا كنت قد شغّلت nomusic، في مساحة تخزين إضافات Chrome، وقد يتزامنان بين أجهزتك عبر Chrome Sync.

قيود ينبغي معرفتها
• قد يبقى بعض الموسيقى، خصوصًا موسيقى الخلفية الخافتة أثناء الكلام. قد تفقد الأصوات البشرية بعض بريقها. هذا ليس ضمانًا لتشغيل خالٍ من الموسيقى.
• تستخدم المعالجة مسار تنفيذ واحدًا في المعالج ونحو 400 ميغابايت من الذاكرة، ويختلف الأداء باختلاف الحاسوب والفيديو.
• لا يمكن معالجة مقاطع الفيديو المحمية من النسخ. عند فشل الإزالة يقول الزر «لم تُزَل الموسيقى». يتوقف الفيديو ويبقى الصوت الأصلي صامتًا حتى تختار «حاول مجددًا» أو «شغّل مع الموسيقى». بعض حالات الفشل تطلب «أعد تحميل الصفحة» بدلًا من ذلك. إذا كان المتصفح ينتظر نقرة قبل تشغيل الصوت، يقول الزر «انقر لتشغيل الصوت».
• يتوقف البث المباشر مرارًا إذا شاهدته عند أحدث نقطة وصل إليها. وتقلّ هذه التوقفات عند المشاهدة بتأخير قليل عن تلك النقطة.
• تدعم الإضافة مشغّلات الموقع على الحاسوب، لا متصفحات الهاتف ولا خدمات فيديو أخرى.

مجانية ومفتوحة المصدر. الشفرة البرمجية والمساعدة: https://github.com/IbraheemTuffaha/nomusic
سياسة الخصوصية: https://github.com/IbraheemTuffaha/nomusic/blob/main/docs/privacy.md

nomusic مشروع مستقل، وهو غير تابع لـ YouTube أو Google ولا يحظى بتأييدهما. YouTube علامة تجارية لـ Google LLC. يخضع استخدام هذه العلامة لشروط Google Permissions.
```

## ألفاظ الواجهة

These are the button strings the description uses. The extension UI uses the
same Arabic (they come from `extension/_locales/ar/messages.json`), including
the ellipsis character … .

| English | Arabic |
| --- | --- |
| Turn on nomusic | شغّل nomusic |
| Set up nomusic | إعداد nomusic |
| Remove music | أزِل الموسيقى |
| Removing music… | تُزال الموسيقى… |
| Music removed | أُزيلت الموسيقى |
| Click to start the sound | انقر لتشغيل الصوت |
| Music not removed | لم تُزَل الموسيقى |
| Try again | حاول مجددًا |
| Reload page | أعد تحميل الصفحة |
| Play with music | شغّل مع الموسيقى |

«شغّل مع الموسيقى» means the video's music will play. Do not soften it to
"original". «أزِل الموسيقى» is the imperative; «أُزيلت الموسيقى» is the state
after removal; «تُزال الموسيقى…» is the progress label. «انقر لتشغيل الصوت»
means the video's sound, not the voices. The voices in the description are
«الأصوات البشرية: الكلام والغناء»: speech and singing, both. Where removal is
described, it removes the sounds of the instruments, «أصوات الآلات الموسيقية»;
the instruments themselves are «الآلات الموسيقية».

