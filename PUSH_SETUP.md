# BNCP News Web Push setup
1. Create a dedicated Web Push app in OneSignal (Custom Code). Site origin: https://sultjung.github.io (same origin as other project pages; use a dedicated OneSignal app, and avoid registering conflicting root-scope workers).
2. Configure custom service worker path `/bismayah2026/push/OneSignalSDKWorker.js` and scope `/bismayah2026/push/`. Default notification URL: https://sultjung.github.io/bismayah2026/; icon: https://sultjung.github.io/bismayah2026/assets/favicon.png.
3. Copy the public App ID into `push-config.json` as appId. Keep REST API key private; add repository Actions secret `ONESIGNAL_REST_API_KEY`. Never put the key in source or chat.
4. Manually run BNCP News Push workflow once to establish baseline (no historic news is sent). Subsequent new domestic, Iraq and COM articles trigger one batch notification after collection or the scheduled check.
5. Open the website on Android Chrome, or install to iOS 16.4+ Home Screen and open the installed app. Click News notification and allow permission. Test a notification from OneSignal dashboard before relying on automatic delivery.
6. Verify workflow logs and real device delivery. No subscribers means no message is delivered. Turning off the button opts out.
The PWA worker is unchanged; OneSignal is in a separate scope. The public site permits any visitor to subscribe; it is not an internal authenticated channel. OneSignal processes subscription/device metadata. Follow company policy and check pricing/quotas before enabling.
