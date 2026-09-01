# 🏙️ Open GTA III (WebAssembly Edition)

Play **Grand Theft Auto III** directly in your modern web browser using WebAssembly (Emscripten), WebAudio, and WebGL!

This is a fully standalone, client-side port ready for immediate deployment on **GitHub Pages**, Cloudflare Pages, Vercel, Netlify, or any static HTTP web host.

---

## 🚀 Features

- **⚡ Zero Backend Required**: Runs 100% in the client browser on static web hosting.
- **🚀 High-Speed Preload**: Optimized 72.6 MB initial asset package with browser `CacheStorage` for sub-second repeat boots.
- **🎮 Full Controls Support**: Keyboard & Mouse with raw mouse capture, Gamepad API support, and on-screen Touch Controls for mobile/tablet devices.
- **🔊 3D Spatial Audio**: 44-channel OpenAL audio engine supporting all original sound effects and radio stations.
- **✨ Modern UI**: Glassmorphic real-time loading overlay with animated progress tracking and diagnostics.

---

## 🕹️ Controls

| Action | Keyboard / Mouse |
| :--- | :--- |
| **Move / Steer** | `W`, `A`, `S`, `D` or Arrow Keys |
| **Look / Aim** | Mouse Movement |
| **Attack / Shoot / Accelerate** | `Left Click` / `Ctrl` |
| **Secondary Fire / Reverse** | `Right Click` |
| **Sprint / Handbrake** | `Space` / `Shift` |
| **Enter / Exit Vehicle** | `F` or `Enter` |
| **Change Camera** | `C` |
| **Change Radio Station** | `R` |
| **Horn / Siren** | `Shift` |
| **Pause / Menu** | `Esc` |

---

## 🌐 Deploy to GitHub Pages (1-Click)

1. Push this repository to your GitHub account:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Open GTA III"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/open_gta_3.git
   git push -u origin main
   ```

2. Enable GitHub Pages:
   - Navigate to your repository on GitHub: **Settings** → **Pages**.
   - Under **Build and deployment**, set **Source** to `Deploy from a branch`.
   - Select branch: `main` and folder `/ (root)`.
   - Click **Save**.

3. Your game is live at:
   ```
   https://<YOUR_USERNAME>.github.io/open_gta_3/
   ```

---

## 💻 Local Development

To run locally with Python's high-speed async server:

```bash
python server.py
```

Then open `http://localhost:8000/index.html` in Chrome, Firefox, or Edge.

---

## ⚖️ Disclaimer

*Grand Theft Auto III* is a trademark of Take-Two Interactive / Rockstar Games. This project is created strictly for educational and personal research purposes.
