package com.pilopresupuestos.app;

import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Envoltorio nativo de la app web (Pilo Presupuestos). Carga los archivos
 * empaquetados en assets/www a través de WebViewAssetLoader (así fetch(),
 * módulos ES y IndexedDB funcionan igual que en un navegador de verdad,
 * sin los problemas de file://). Expone un puente en JS (AndroidBridge)
 * para que exportar/compartir el PDF del presupuesto use el sistema de
 * archivos y el selector de "compartir" nativos de Android.
 */
public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Navegación dentro de la propia app: la maneja el WebView.
                if ("appassets.androidplatform.net".equals(uri.getHost())) {
                    return false;
                }
                // Cualquier link externo (WhatsApp, tel:, mailto:, etc.) lo
                // abre la app correspondiente del sistema.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** Puente expuesto a la app web como `window.AndroidBridge`. */
    private class AndroidBridge {

        @JavascriptInterface
        public void saveBase64Pdf(String base64, String filename) {
            runOnUiThread(() -> {
                boolean ok = writePdfToDownloads(base64, filename);
                Toast.makeText(
                        MainActivity.this,
                        ok ? "Guardado en Descargas: " + filename : "No se pudo guardar el PDF",
                        Toast.LENGTH_LONG
                ).show();
            });
        }

        @JavascriptInterface
        public void shareBase64Pdf(String base64, String filename, String text) {
            runOnUiThread(() -> {
                Uri contentUri = writePdfToCacheForSharing(base64, filename);
                if (contentUri == null) {
                    Toast.makeText(MainActivity.this, "No se pudo preparar el PDF para compartir", Toast.LENGTH_LONG).show();
                    return;
                }
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                if (text != null && !text.isEmpty()) {
                    shareIntent.putExtra(Intent.EXTRA_TEXT, text);
                }
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(shareIntent, "Compartir presupuesto"));
            });
        }
    }

    /** Guarda el PDF en la carpeta pública de Descargas del dispositivo. */
    private boolean writePdfToDownloads(String base64, String filename) {
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
                Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item == null) return false;
                try (OutputStream out = getContentResolver().openOutputStream(item)) {
                    if (out == null) return false;
                    out.write(bytes);
                }
                return true;
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return false;
                File file = new File(dir, filename);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                return true;
            }
        } catch (IOException e) {
            return false;
        }
    }

    /** Guarda el PDF en caché privada y devuelve una content:// URI apta para compartir. */
    private Uri writePdfToCacheForSharing(String base64, String filename) {
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
        try {
            File cacheDir = new File(getCacheDir(), "shared");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) return null;
            File file = new File(cacheDir, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
        } catch (IOException e) {
            return null;
        }
    }
}
