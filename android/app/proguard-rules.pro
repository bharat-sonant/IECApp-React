# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.infer.annotation.** { *; }
-keepclassmembers class * {
    @com.facebook.infer.annotation.* *;
}

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# Google Play Services Location
-keep class com.google.android.gms.location.** { *; }
-keep class com.google.android.gms.internal.location.** { *; }

# Ignore missing Java classes not present in Android (due to javazoom/jlayer mp3 playback)
-dontwarn java.applet.**
-dontwarn java.awt.**
-dontwarn javax.sound.**
-dontwarn javazoom.**

# Keep native methods
-keepclassmembers class * {
    @com.facebook.hermes.unicode.* <methods>;
}

# React Native Vector Icons
-dontwarn com.google.android.material.**
-keep class com.oblador.** { *; }
-keep class * extends com.facebook.react.views.text.ReactFontManager { *; }

# Keep ViewManagers
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }

# Keep TurboModules
-keep class * implements com.facebook.react.turbomodule.core.TurboModule { *; }

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# Keep R8 from removing classes
-keep class ** {
    @com.facebook.react.annotation.* *;
}