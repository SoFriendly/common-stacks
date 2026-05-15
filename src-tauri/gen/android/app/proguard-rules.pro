# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep rustls-platform-verifier's Kotlin support class — it's loaded
# reflectively from Rust via JNI, so R8 has no static call site to
# notice. Without this, every HTTPS request from Rust fails with
# ClassNotFoundException: org/rustls/platformverifier/CertificateVerifier
-keep class org.rustls.platformverifier.** { *; }