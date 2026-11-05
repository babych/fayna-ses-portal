# 📖 System Architecture & Engineering Documentation

> **Fayna SES Energy Portal** — Progressive Web App (PWA) engineered for real-time monitoring of battery reserves, solar PV generation, municipal power grid availability, and blackout analytics across the **Fayna Town** residential complex (Kyiv).

---

## 1. 📐 High-Level Architecture

```
                               ┌───────────────────────────────────┐
                               │     data-ses.funs.net.ua          │
                               │  (Upstream Fayna SES Telemetry)   │
                               └─────────────────┬─────────────────┘
                                                 │
                             ┌───────────────────┴───────────────────┐
                             │    Cloudflare Pages Functions         │
                             │    /api/[[path]].ts (Edge Proxy)      │
                             │  • CORS Headers Injection             │
                             │  • Edge Cache (s-maxage=60)           │
                             │  • Upstream Load Shielding            │
                             └───────────────────┬───────────────────┘
                                                 │
                             ┌───────────────────┴───────────────────┐
                             │       Vue 3 SPA + Vite + PWA          │
                             │  • Pure Light Theme Architecture      │
                             │  • Dual-language i18n (UA / EN)       │
                             │  • Guided PWA Installation Modal      │
                             │  • Tree-shaken Chart.js Analytics     │
                             │  • 24-Hour Blackout Timeline Grid     │
                             │  • Hardware & Inverter Load Metrics   │
                             └───────────────────────────────────────┘
```

---

## 2. ☀️ Pure Light Theme Philosophy

* **Visual Cohesion**: Built around a clean slate-neutral palette (`#f8fafc`, `#ffffff`, `#e2e8f0`) with natural emerald accents (`#10b981`), ensuring optimal readability under daylight.
* **Component-Level Scrollbars**:
  * Scrollbars are confined strictly within the inner body container (`.modal-scroll`).
  * Inset margin geometry (`margin: 8px 0`) and slim track widths (`6px`) prevent scrollbar tracks from clipping container border-radii (`rounded-3xl`).
* **Clean Light Favicon**: White high-contrast background with an emerald energy lightning bolt gradient.

---

## 3. 📲 Universal PWA Installation Flow

The header **"Install"** button provides cross-platform Progressive Web App onboarding:
1. **Desktop (Chrome / Edge / Brave / Opera) & Android**:
   * Captures the native `beforeinstallprompt` event for seamless one-click installation.
2. **iOS Safari & Unsupported Browsers**:
   * Opens the localized `PwaInstallModal.vue` displaying intuitive step-by-step guidance:
     * **iOS Safari**: Tap the **"Share"** button $\to$ select **"Add to Home Screen"**.
     * **Android Chrome**: Open browser menu ($\vdots$) $\to$ tap **"Install App"**.
     * **Desktop Browsers**: Click the install icon inside the URL address bar.

---

## 4. 🔌 Telemetry Ingestion & Upstream API Specification

The portal processes public JSON telemetry streams from Fayna SES stations:

| Endpoint | Description | Key Telemetry Fields |
|---|---|---|
| `GET /api/<id>/station.json` | Station hardware metadata | `name`, `description`, `batteryKwh`, `inverterKw`, `pvKw` |
| `GET /api/<id>/today.json` | Today's rolling telemetry (~5 min cadence) | `t` (timestamps), `soc` (%), `batt` (W), `grid` (W), `load` (W), `pv` (W), `day` |
| `GET /api/<id>/month/<YYYY-MM>.json` | Monthly historical totals by day | `days`, `pv` (kWh), `grid` (kWh), `load` (kWh) |

### Automatic Month Fallback Strategy
At the beginning of each calendar month, upstream monthly archives may return `404 Not Found` or empty arrays before telemetry accumulates. The client dynamically falls back to the previous month (`YYYY-(MM-1)`) to ensure historical charts remain populated.

---

## 5. ⚡ Blackout Detection & Analytics Engine

### A. Real-Time Outage State Detection
An active blackout condition is evaluated from `today.json` samples:
$$\text{Grid Power} \le 20\text{ W} \quad \land \quad \text{Building Load} > 20\text{ W}$$

### B. 24-Hour Timeline Grid Classification
Each hour interval ($H \in [0, 23]$) is categorized into one of four distinct visual states:
* 🟢 **Normal Grid (`220V`)**: Total outage duration in this hour $< 15$ minutes (`bg-emerald-100`).
* 🟡 **Partial Outage (`½ BATT` / `½ АКБ`)**: Outage duration between $15$ and $45$ minutes, rendered with a two-color vertical split gradient (`bg-gradient-to-t from-rose-500 from-50% to-emerald-100 to-50%`).
* 🔴 **Full Outage (`BATT` / `АКБ`)**: Outage duration $> 45$ minutes sustained by backup batteries (`bg-rose-500`).
* ⚪ **Upcoming (`—`)**: Future hours that have not yet occurred relative to current telemetry time (`bg-slate-100/70 border-dashed`).

### C. Monthly Outage Energy Dynamic
Calculates the backup battery energy delivered to the building during grid disruptions:
$$E_{\text{Backup}} = \max(0, \text{Load} - \text{Grid}) \quad \text{[kWh]}$$

---

## 6. 🌍 Localization (i18n) Engine

* **Dynamic Language Switching**: Ukrainian (`UA`) and English (`EN`) with live reactivity.
* **Auto-Detection**:
  ```typescript
  const browserLang = (navigator.language || '').toLowerCase();
  const defaultLocale = browserLang.startsWith('uk') ? 'uk' : 'en';
  ```
* **Dynamic Content Translation**: Building names, elevator references, status badges, and units (`kWh` ⇄ `кВт·г`, `kW` ⇄ `кВт`, `W` ⇄ `Вт`) update reactively without page reloads.

---

## 7. 🛠️ Build & Verification Pipeline

```bash
# Typecheck & bundle assets
npm run build

# Direct deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=fayna-ses --commit-dirty=true --branch=main
```
