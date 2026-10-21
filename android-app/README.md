# Higher Grade Pay - ITI Android App

This is a lightweight Android WebView wrapper for the deployed Higher Grade Pay - ITI web app.

## Configure the web app URL

Edit `app/src/main/res/values/strings.xml` and replace the placeholder with the final HTTPS Render URL. The app starts directly at `/login.html`.

## Build with Android Studio

1. Install Android Studio with Android SDK Platform 35 and a JDK supported by Android Gradle Plugin 8.7.
2. Open this `android-app` directory in Android Studio and allow Gradle sync.
3. Build a debug APK from **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. For Google Play, use **Build > Generate Signed Bundle / APK**, choose **Android App Bundle**, and create a release keystore.
5. Keep the keystore and passwords outside the repository. Upload the signed `.aab` through Google Play Console.

The app requires an HTTPS deployment URL. External websites, email links, telephone links, and material downloads open in the appropriate Android app; pages hosted on the configured Render domain stay inside the WebView. Android back navigates WebView history before closing the app.

## AdMob banner ads

The Android app shows one native adaptive banner below the WebView, without
interstitial ads interrupting practice. The web app viewed in a regular browser
does not show these ads. Google consent messaging is requested through the UMP
SDK, and the app shows an **Ad privacy settings** entry point when Google
requires one.

The IDs in `app/src/main/res/values/strings.xml` are Google's test IDs. Before
publishing, replace `admob_app_id` and `admob_banner_ad_unit_id` with the
corresponding IDs from your AdMob app and banner ad unit. Configure and publish
the applicable consent messages in AdMob **Privacy & messaging**. Continue
using Google's test ad unit IDs during development; do not click live ads while
testing. Review the Play Console Data safety form and the public privacy policy
when enabling advertising. The current Mobile Ads SDK requires Android 7.0
(API 24) or later, so Android 6.0 devices are no longer supported.

The repository includes the Gradle wrapper. On Windows, build a debug APK with `.\gradlew.bat :app:assembleDebug` from this directory after installing a compatible JDK and Android SDK.
