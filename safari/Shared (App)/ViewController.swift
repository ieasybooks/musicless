import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

private let extensionBundleIdentifier = "com.ieasybooks.musicless.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private var didFinishLoading = false

    override func viewDidLoad() {
        super.viewDidLoad()

        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")

#if os(iOS)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.backgroundColor = .systemBackground
#elseif os(macOS)
        webView.setValue(false, forKey: "drawsBackground")
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
#endif

        if let url = Bundle.main.url(forResource: "Main", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.resourceURL!)
        }
    }

#if os(macOS)
    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func applicationDidBecomeActive() {
        if didFinishLoading {
            refreshExtensionState()
        }
    }
#endif

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        didFinishLoading = true
        pushState(enabled: nil)

#if os(macOS)
        refreshExtensionState()
#endif
    }

    private func preferredLanguageCode() -> String {
        let primary = Locale.preferredLanguages.first?.lowercased() ?? "en"
        return primary.hasPrefix("ar") ? "ar" : "en"
    }

    private func platformName() -> String {
#if os(iOS)
        return UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "ios"
#elseif os(macOS)
        return "mac"
#endif
    }

    private func pushState(enabled: Bool?) {
        let lang = preferredLanguageCode()
        let platform = platformName()
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
        let enabledLiteral: String
        if let enabled {
            enabledLiteral = enabled ? "true" : "false"
        } else {
            enabledLiteral = "null"
        }
        let js = "window.musiclessInit({platform:'\(platform)',lang:'\(lang)',enabled:\(enabledLiteral),version:'\(version)'});"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

#if os(macOS)
    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            guard let self, let state, error == nil else { return }
            DispatchQueue.main.async {
                self.pushState(enabled: state.isEnabled)
            }
        }
    }
#endif

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(macOS)
        guard (message.body as? String) == "open-preferences" else { return }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
#endif
    }

}
