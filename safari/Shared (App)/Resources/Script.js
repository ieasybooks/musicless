const COPY = {
    en: {
        title: "Musicless",
        subtitle: "Remove music from YouTube videos while keeping voices.",
        statusOn: "Musicless is enabled in Safari",
        statusOff: "Musicless is currently off in Safari",
        stepsHeading: "Set up in Safari",
        macSteps: [
            "Open <strong>Safari Settings → Extensions</strong>.",
            "Turn on <strong>Musicless</strong>.",
            "Under Websites, allow <span class=\"domains\">youtube.com</span>, <span class=\"domains\">m.youtube.com</span>, and <span class=\"domains\">youtube-nocookie.com</span>."
        ],
        iosSteps: [
            "Open <strong>Settings → Apps → Safari → Extensions</strong>.",
            "Tap <strong>Musicless</strong> and turn on <strong>Allow Extension</strong>.",
            "Allow <span class=\"domains\">youtube.com</span>, <span class=\"domains\">m.youtube.com</span>, and <span class=\"domains\">youtube-nocookie.com</span>."
        ],
        openPreferences: "Open Safari Settings…",
        mobileTip: "Then open YouTube in Safari — the Musicless button appears inside the video player.",
        privacy: "Audio is processed privately on your device."
    },
    ar: {
        title: "بلا موسيقى",
        subtitle: "أزِل الموسيقى من فيديوهات يوتيوب وأبقِ على الأصوات.",
        statusOn: "ملحق بلا موسيقى مُفعَّل في سفاري",
        statusOff: "ملحق بلا موسيقى متوقف حالياً في سفاري",
        stepsHeading: "الإعداد في سفاري",
        macSteps: [
            "افتح <strong>إعدادات سفاري ← الملحقات</strong>.",
            "فعِّل ملحق <strong>بلا موسيقى</strong>.",
            "اسمح له بالعمل على <span class=\"domains\">youtube.com</span> و<span class=\"domains\">m.youtube.com</span> و<span class=\"domains\">youtube-nocookie.com</span>."
        ],
        iosSteps: [
            "افتح <strong>الإعدادات ← التطبيقات ← سفاري ← الملحقات</strong>.",
            "اختر <strong>بلا موسيقى</strong> وفعِّل <strong>السماح بالملحق</strong>.",
            "اسمح له بالعمل على <span class=\"domains\">youtube.com</span> و<span class=\"domains\">m.youtube.com</span> و<span class=\"domains\">youtube-nocookie.com</span>."
        ],
        openPreferences: "فتح إعدادات سفاري…",
        mobileTip: "بعد ذلك افتح يوتيوب في سفاري — سيظهر زر بلا موسيقى داخل مشغّل الفيديو.",
        privacy: "تُعالج الصوتيات محلياً على جهازك بخصوصية تامة."
    }
};

function render({ platform, lang, enabled, version }) {
    const locale = lang === "ar" ? "ar" : "en";
    const strings = COPY[locale];

    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = strings.title;

    document.body.classList.remove("platform-mac", "platform-ios", "platform-ipad");
    document.body.classList.add(`platform-${platform}`);

    document.getElementById("title").textContent = strings.title;
    document.getElementById("subtitle").textContent = strings.subtitle;
    document.getElementById("steps-heading").textContent = strings.stepsHeading;
    document.getElementById("open-preferences").textContent = strings.openPreferences;
    document.getElementById("mobile-tip").textContent = strings.mobileTip;
    document.getElementById("privacy").textContent = strings.privacy;

    const versionEl = document.getElementById("version");
    if (version) {
        versionEl.textContent = `v${version}`;
        versionEl.hidden = false;
    }

    const stepsEl = document.getElementById("steps");
    const stepList = platform === "mac" ? strings.macSteps : strings.iosSteps;
    stepsEl.innerHTML = stepList
        .map((html) => `<li><span class="step-body">${html}</span></li>`)
        .join("");

    const pill = document.getElementById("status-pill");
    const statusText = document.getElementById("status-text");
    if (platform === "mac" && typeof enabled === "boolean") {
        pill.hidden = false;
        pill.classList.toggle("is-enabled", enabled);
        statusText.textContent = enabled ? strings.statusOn : strings.statusOff;
    } else {
        pill.hidden = true;
    }
}

window.musiclessInit = render;

document.addEventListener("DOMContentLoaded", () => {
    const initialLang = (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";
    const initialPlatform = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios" : "mac";
    render({ platform: initialPlatform, lang: initialLang, enabled: null, version: "" });

    document.getElementById("open-preferences").addEventListener("click", () => {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.controller) {
            window.webkit.messageHandlers.controller.postMessage("open-preferences");
        }
    });
});
