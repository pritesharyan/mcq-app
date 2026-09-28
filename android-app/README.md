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

The current workspace does not include the Android SDK or Gradle executable, so the APK cannot be compiled from this machine until Android Studio or the Android command-line toolchain is installed.
