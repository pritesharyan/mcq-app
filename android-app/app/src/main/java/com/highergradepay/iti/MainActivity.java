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
import android.webkit.JsResult;
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String startUrl = getString(com.highergradepay.iti.R.string.web_app_url);
        appUri = Uri.parse(startUrl);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openUrl(Uri.parse(url));
            }
        });
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
