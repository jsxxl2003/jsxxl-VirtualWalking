package de.virtualwalking.receiver;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Enumeration;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String PLAYER_ORIGIN = "https://de.virtualwalking.receiver";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private ServerSocket listener;
    private WebView web;
    private TextView label;
    private String key;
    private volatile String videoId = "";
    private volatile String state = "ready";
    private volatile double rate = 1.0;
    private volatile String playerFeedback = "{}";
    private volatile long feedbackAt;
    public final class PlayerFeedback {
        @android.webkit.JavascriptInterface public void update(String value) {
            if (value == null || value.length() > 512) return;
            try {
                JSONObject report = new JSONObject(value);
                String id = report.optString("playerVideoId", "");
                if (!id.isEmpty() && !id.matches("[A-Za-z0-9_-]{11}")) return;
                double actual = report.optDouble("actualRate", 1.0);
                if (!Double.isFinite(actual) || actual <= 0 || actual > 16) return;
                playerFeedback = report.toString();
                feedbackAt = android.os.SystemClock.elapsedRealtime();
            } catch (Exception ignored) {}
        }
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        android.content.SharedPreferences settings = getSharedPreferences("receiver", MODE_PRIVATE);
        key = settings.getString("connectionKey", null);
        if (key == null || !key.matches("[a-f0-9]{24}")) {
            byte[] secret = new byte[12];
            new SecureRandom().nextBytes(secret);
            StringBuilder b = new StringBuilder();
            for (byte c : secret) b.append(String.format(Locale.US, "%02x", c & 255));
            key = b.toString();
            if (!settings.edit().putString("connectionKey", key).commit()) {
                throw new IllegalStateException("Verbindungsschluessel konnte nicht gespeichert werden");
            }
        }
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xff19151f);
        web = new WebView(this);
        web.setBackgroundColor(0xff19151f);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new PlayerFeedback(), "VWTvFeedback");
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        label = new TextView(this);
        label.setTextColor(0xffffffff);
        label.setTextSize(21);
        label.setGravity(Gravity.CENTER);
        label.setPadding(28, 28, 28, 28);
        label.setBackgroundColor(0xee211b2c);
        frame.addView(label, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        web.loadDataWithBaseURL(PLAYER_ORIGIN + "/", html(), "text/html", "UTF-8", null);
        workers.execute(this::serve);
        updateLabel();
    }

    private String ip() {
        try {
            Enumeration<NetworkInterface> nets = NetworkInterface.getNetworkInterfaces();
            while (nets.hasMoreElements()) {
                NetworkInterface n = nets.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                Enumeration<InetAddress> addresses = n.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress a = addresses.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return "IP nicht gefunden";
    }
    private void updateLabel() {
        ui.post(() -> label.setText("VirtualWalking · TV-Empfänger\n\nAdresse: http://" + ip() + ":8765\n\nSchlüssel: " + key + "\n\nBereit für Verbindung vom iPhone"));
    }
    private String html() {
        return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<meta name='referrer' content='strict-origin-when-cross-origin'>"
            + "<style>html,body,#player{width:100%;height:100%;margin:0;background:#000}</style></head>"
            + "<body><div id='player'></div><script>"
            + "var player=null,ready=false,pendingId=null,pendingRate=1,pendingPause=false,pendingStop=false,playerError=0;"
            + "function report(){try{if(ready)VWTvFeedback.update(JSON.stringify({playerReady:ready,playerState:player.getPlayerState(),actualRate:player.getPlaybackRate(),playerVideoId:player.getVideoData().video_id||'',playerError:playerError}));}catch(e){}}setInterval(report,1000);"
            + "function onYouTubeIframeAPIReady(){player=new YT.Player('player',{height:'100%',width:'100%',"
            + "playerVars:{playsinline:1,autoplay:1,origin:'" + PLAYER_ORIGIN + "',widget_referrer:'" + PLAYER_ORIGIN + "/'},"
            + "events:{onReady:function(){ready=true;if(pendingId){player.loadVideoById(pendingId);player.setPlaybackRate(pendingRate);if(pendingPause)player.pauseVideo();if(pendingStop)player.seekTo(0,true);}report();},onStateChange:report,onPlaybackRateChange:report,"
            + "onError:function(e){playerError=e.data;report();console.error('VirtualWalking YouTube error: '+e.data);}}});}"
            + "function vwPlay(id){pendingId=id;pendingPause=false;pendingStop=false;playerError=0;if(ready)player.loadVideoById(id);}"
            + "function vwPause(){pendingPause=true;if(ready)player.pauseVideo();}"
            + "function vwResume(){pendingPause=false;pendingStop=false;if(ready)player.playVideo();}"
            + "function vwStop(){pendingPause=true;pendingStop=true;if(ready){player.pauseVideo();player.seekTo(0,true);}}"
            + "function vwRate(v){pendingRate=v;if(ready)player.setPlaybackRate(v);}"
            + "</script><script src='https://www.youtube.com/iframe_api'></script></body></html>";
    }
    private void js(String command) { ui.post(() -> web.evaluateJavascript(command, null)); }
    private void serve() {
        try (ServerSocket server = new ServerSocket(8765)) {
            listener = server;
            while (!server.isClosed()) {
                Socket socket = server.accept();
                socket.setSoTimeout(3000);
                workers.execute(() -> handle(socket));
            }
        } catch (IOException e) {
            ui.post(() -> label.setText("Empfänger konnte Port 8765 nicht öffnen: " + e.getMessage()));
        }
    }
    private void handle(Socket socket) {
        try (Socket s = socket) {
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String first = in.readLine();
            if (first == null || !first.startsWith("GET ")) return;
            String[] pieces = first.split(" ");
            if (pieces.length < 2) return;
            while (true) { String h = in.readLine(); if (h == null || h.isEmpty()) break; }
            URI uri = new URI("http://localhost" + pieces[1]);
            java.util.Map<String,String> args = new java.util.HashMap<>();
            if (uri.getRawQuery() != null) for (String item : uri.getRawQuery().split("&")) {
                String[] kv = item.split("=", 2);
                args.put(URLDecoder.decode(kv[0], "UTF-8"), kv.length == 2 ? URLDecoder.decode(kv[1], "UTF-8") : "");
            }
            int code = 200;
            JSONObject result = new JSONObject();
            result.put("receiver", "VirtualWalking-TV");
            result.put("version", "0.1.4");
            if (!key.equals(args.get("key"))) { code = 403; result.put("error", "Schlüssel ungültig"); }
            else {
                String route = uri.getPath();
                if ("/play".equals(route)) {
                    String id = args.getOrDefault("id", "");
                    if (!id.matches("[A-Za-z0-9_-]{11}")) { code = 400; result.put("error", "Ungültige YouTube-ID"); }
                    else { videoId = id; state = "requested"; js("vwPlay(" + JSONObject.quote(id) + ")"); ui.post(() -> label.setVisibility(View.GONE)); }
                } else if ("/pause".equals(route)) { js("vwPause()"); state = "pause-requested"; }
                else if ("/stop".equals(route)) { js("vwStop()"); state = "stop-requested"; }
                else if ("/resume".equals(route)) { js("vwResume()"); state = "resume-requested"; }
                else if ("/rate".equals(route)) {
                    try { double v = Double.parseDouble(args.getOrDefault("value", "")); if (!Double.isFinite(v) || v < 0.25 || v > 2.0) throw new IllegalArgumentException(); rate = v; js("vwRate(" + v + ")"); }
                    catch (Exception e) { code = 400; result.put("error", "Geschwindigkeit außerhalb 0.25–2.0"); }
                } else if (!"/status".equals(route)) { code = 404; result.put("error", "Unbekannter Befehl"); }
                result.put("videoId", videoId); result.put("state", state); result.put("requestedRate", rate);
                JSONObject feedback = new JSONObject(playerFeedback);
                result.put("playerReady", feedback.optBoolean("playerReady", false));
                result.put("playerState", feedback.optInt("playerState", -1));
                result.put("playerVideoId", feedback.optString("playerVideoId", ""));
                result.put("actualRate", feedback.optDouble("actualRate", 1.0));
                result.put("playerError", feedback.optInt("playerError", 0));
                result.put("feedbackAgeMs", feedbackAt == 0 ? 999999 : android.os.SystemClock.elapsedRealtime() - feedbackAt);
                result.put("note", "HTTP bestaetigt den Auftrag. playerState und actualRate stammen vom YouTube-Player.");
            }
            byte[] body = result.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream out = s.getOutputStream();
            out.write(("HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "Error") + "\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.write(body); out.flush();
        } catch (Exception ignored) {}
    }
    @Override public void onDestroy() {
        try { if (listener != null) listener.close(); } catch (IOException ignored) {}
        workers.shutdownNow();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
