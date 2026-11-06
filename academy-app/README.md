# AiHive Academy (Android)

The members' app. Members add the academy their teacher shared (paste the `/learn/<handle>` link or type the code), and its members area opens inside this app. Everything the window shows is protected: screenshots, screen recordings, screen sharing and the recent-apps preview all come out black (`FLAG_SECURE` in `MainActivity.java`).

- App id `in.getaihive.academy`, name **AiHive Academy**.
- `www/` holds the app's own screens (first-run tour, my academies, add an academy, offline page). It has no build step.
- Academies load from `https://app.getaihive.in/learn/<handle>`. Only that host may open inside the app; every other link opens in the browser.
- The app adds `AiHiveAcademy/1.0` to its user agent. The website uses this to tell the app apart:
  - **Academy → Settings → Protection → App only on Android**: on Android phones, lessons play only in the app.
  - Inside the app, the members area shows a back button to *My academies*.
- `aihiveacademy://learn/<handle>` opens an academy in the app. The website's "Open in the app" button uses it, and falls back to the Play Store when the app isn't installed.

## Build

You need JDK 21 and the Android SDK (platform 36, build-tools). Set `JAVA_HOME` and `ANDROID_HOME`, then:

```bash
npm install
npm run icons      # only after changing the icon design
npm run aab        # → android/app/build/outputs/bundle/release/app-release.aab
```

A release build is signed only when `android/keystore.properties` exists:

```
storeFile=C:/path/to/aihive-academy-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Keep the keystore and its passwords **out of git**, with a backup. Every future update must be signed with the same key. With Play App Signing, a lost upload key can be reset from Play Console.

## Release

1. Raise `versionCode` and `versionName` in `android/app/build.gradle`.
2. `npm run aab`.
3. Upload the `.aab` in Play Console (internal testing first). Use `release/play-icon-512.png` as the store icon.
