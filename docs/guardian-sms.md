# NAVI Guardian SMS delivery decision

NAVI Guardian's automatic cellular SMS path needs Android `SEND_SMS` runtime permission. It is requested only after the user enters and confirms a contact and enables Guardian. The app does not request SMS read permissions or read the contact list. A user-controlled SMS composer is the fallback when permission, SIM selection or cellular service prevents automatic sending.

Google Play restricts `SEND_SMS`. Its [SMS and Call Log policy](https://support.google.com/googleplay/android-developer/answer/10208820) lists physical safety and emergency alerts as a possible exception, subject to declaration and review; this is **not** an approval for NAVI. Play distribution must obtain the exception or use only the SMS composer without declaring `SEND_SMS`.

Android's [SmsManager documentation](https://developer.android.com/reference/android/telephony/SmsManager) distinguishes a send callback from a delivery callback. NAVI must report "send requested", "sent", and "delivery confirmed" separately; a missing delivery report remains unconfirmed. On devices with multiple SIMs and no default SMS subscription, NAVI must use the composer instead of silently choosing one.

No cloud SMS service is used. Cellular SMS can work with Wi-Fi and mobile data off, but needs carrier service. Guardian shake monitoring is foreground-only; [Android sensor guidance](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview) warns that background sensor access is restricted. Leaving the app stops monitoring and cancels a pending countdown.
