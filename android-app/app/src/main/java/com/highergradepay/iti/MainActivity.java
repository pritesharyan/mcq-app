package com.highergradepay.iti;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

public class MainActivity extends Activity {
    private static final String TAG = "MainActivity";

    private WebView webView;
    private AdView adView;
    private LinearLayout adContainer;
    private Button privacyOptionsButton;
    private ConsentInformation consentInformation;
    private boolean adsInitialized;
    private Uri appUri;
    private String lastMainFrameUrl;
    private boolean offlineShowing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String startUrl = getString(com.highergradepay.iti.R.string.web_app_url);
        appUri = Uri.parse(startUrl);
        lastMainFrameUrl = startUrl;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int baseBottomPadding = root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(view.getPaddingLeft(), view.getPaddingTop(), view.getPaddingRight(),
                    baseBottomPadding + insets.getSystemWindowInsetBottom());
            return insets;
        });

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1));

        adContainer = new LinearLayout(this);
        adContainer.setOrientation(LinearLayout.VERTICAL);
        adContainer.setGravity(Gravity.CENTER);
        adContainer.setVisibility(ViewGroup.GONE);
        root.addView(adContainer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        privacyOptionsButton = new Button(this);
        privacyOptionsButton.setText("Ad privacy settings");
        privacyOptionsButton.setVisibility(ViewGroup.GONE);
        privacyOptionsButton.setOnClickListener(view ->
                UserMessagingPlatform.showPrivacyOptionsForm(this, formError -> {
                    if (formError != null) {
                        Log.w(TAG, "Unable to show ad privacy options: " + formError.getMessage());
                    }
                }));
        adContainer.addView(privacyOptionsButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!offlineShowing) lastMainFrameUrl = url;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openUrl(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (!request.isForMainFrame()) return;
                lastMainFrameUrl = request.getUrl().toString();
                Log.w(TAG, "Main page load failed: " + error.getDescription());
                showOfflinePage(view);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            android.webkit.WebResourceResponse response) {
                super.onReceivedHttpError(view, request, response);
                if (!request.isForMainFrame() || response.getStatusCode() < 500) return;
                lastMainFrameUrl = request.getUrl().toString();
                Log.w(TAG, "Main page returned HTTP " + response.getStatusCode());
                showOfflinePage(view);
            }
        });
        webView.addJavascriptInterface(new OfflinePageBridge(), "OfflinePage");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(R.string.app_name)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(R.string.app_name)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openExternal(Uri.parse(url)));
        webView.loadUrl(startUrl);

        requestAdConsent();
    }

    private void showOfflinePage(WebView view) {
        if (offlineShowing || isFinishing() || isDestroyed()) return;
        offlineShowing = true;
        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">"
                + "<style>"
                + "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;"
                + "padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));"
                + "font-family:Arial,sans-serif;color:#263b48;background:linear-gradient(145deg,#edf7f8,#f8f6ed)}"
                + "main{width:min(100%,420px);padding:36px 28px;text-align:center;background:#fff;"
                + "border:1px solid #dce8e9;border-radius:18px;box-shadow:0 16px 48px #243d4a1c}"
                + ".icon{width:64px;height:64px;margin:0 auto 20px;display:grid;place-items:center;"
                + "border-radius:50%;background:#e7f4f5;color:#247a9d;font-size:30px}"
                + "h1{margin:0 0 12px;font-size:24px}p{margin:0;color:#61727b;line-height:1.6}"
                + "button{margin-top:24px;padding:12px 26px;border:0;border-radius:8px;background:#247a9d;"
                + "color:#fff;font-size:16px;font-weight:700}"
                + "</style></head><body><main><div class=\"icon\" aria-hidden=\"true\">⌁</div>"
                + "<h1>No Internet Connection</h1>"
                + "<p>Please check your network settings and try again.</p>"
                + "<button type=\"button\" onclick=\"OfflinePage.retry()\">Retry</button>"
                + "</main></body></html>";
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private final class OfflinePageBridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> {
                if (webView == null || isFinishing() || isDestroyed()) return;
                offlineShowing = false;
                webView.loadUrl(lastMainFrameUrl);
            });
        }
    }

    private void requestAdConsent() {
        consentInformation = UserMessagingPlatform.getConsentInformation(this);
        ConsentRequestParameters parameters = new ConsentRequestParameters.Builder().build();
        consentInformation.requestConsentInfoUpdate(
                this,
                parameters,
                () -> {
                    privacyOptionsButton.setVisibility(
                            consentInformation.getPrivacyOptionsRequirementStatus()
                                    == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
                                    ? ViewGroup.VISIBLE : ViewGroup.GONE);
                    updateAdContainerVisibility();
                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                            this,
                            formError -> {
                                if (formError != null) {
                                    Log.w(TAG, "Unable to show ad consent form: " + formError.getMessage());
                                }
                                initializeAdsIfAllowed();
                            });
                },
                requestError -> {
                    Log.w(TAG, "Unable to update ad consent information: " + requestError.getMessage());
                    initializeAdsIfAllowed();
                });
    }

    private void initializeAdsIfAllowed() {
        if (isFinishing() || isDestroyed() || consentInformation == null
                || !consentInformation.canRequestAds() || adsInitialized) {
            return;
        }

        adsInitialized = true;
        MobileAds.initialize(this, initializationStatus -> runOnUiThread(this::loadBannerAd));
    }

    private void loadBannerAd() {
        if (isFinishing() || isDestroyed() || adContainer == null) return;

        DisplayMetrics displayMetrics = getResources().getDisplayMetrics();
        int widthDp = (int) (displayMetrics.widthPixels / displayMetrics.density);
        AdView bannerView = new AdView(this);
        adView = bannerView;
        bannerView.setAdUnitId(getString(R.string.admob_banner_ad_unit_id));
        bannerView.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(this, widthDp));
        bannerView.setAdListener(new AdListener() {
            @Override
            public void onAdLoaded() {
                if (isFinishing() || isDestroyed() || adView != bannerView) return;
                bannerView.setVisibility(ViewGroup.VISIBLE);
                adContainer.setVisibility(ViewGroup.VISIBLE);
            }

            @Override
            public void onAdFailedToLoad(LoadAdError error) {
                Log.w(TAG, "Banner ad failed to load: " + error.getMessage());
                if (isFinishing() || isDestroyed() || adView != bannerView) return;
                bannerView.setVisibility(ViewGroup.GONE);
                updateAdContainerVisibility();
            }
        });
        bannerView.setVisibility(ViewGroup.GONE);
        adContainer.addView(bannerView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        updateAdContainerVisibility();
        bannerView.loadAd(new AdRequest.Builder().build());
    }

    private void updateAdContainerVisibility() {
        boolean hasBanner = adView != null && adView.getVisibility() == ViewGroup.VISIBLE;
        boolean hasPrivacyOptions = privacyOptionsButton.getVisibility() == ViewGroup.VISIBLE;
        adContainer.setVisibility(hasBanner || hasPrivacyOptions ? ViewGroup.VISIBLE : ViewGroup.GONE);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private boolean openUrl(Uri uri) {
        if (uri.getScheme() == null) return true;
        if (uri.getScheme().equals("http") || uri.getScheme().equals("https")) {
            if (appUri.getHost() != null && appUri.getHost().equalsIgnoreCase(uri.getHost())) {
                return false;
            }
            return openExternal(uri);
        }
        return openExternal(uri);
    }

    private boolean openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "No application can open this link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (adView != null) adView.resume();
    }

    @Override
    protected void onPause() {
        if (adView != null) adView.pause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (adView != null) {
            adView.destroy();
            adView = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
