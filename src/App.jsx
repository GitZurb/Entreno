/*
 * Entreno · entrenador personal de un solo usuario.
 *
 * Un único archivo React. Se ejecuta de dos formas:
 *   1. Autónomo (fase 1): dist/index.html incrusta el bundle y monta <entreno-panel>.
 *      `hass` es nulo y toda la integración queda inactiva, la app funciona en local.
 *   2. Panel personalizado de Home Assistant (fase 2): dist/panel.js se copia a
 *      config/www/entrenador/panel.js y se registra con panel_custom. Home Assistant
 *      asigna las propiedades hass, narrow, route y panel al elemento <entreno-panel>.
 *
 * AVISO DE CACHÉ: los ficheros de config/www se sirven con caché agresiva. Al
 * actualizar el panel, cambia la versión en la URL del módulo
 * (module_url: /local/entrenador/panel.js?v=X.Y.Z) para que el navegador lo recargue.
 *
 * Arquitectura de datos:
 *   - Datos propios (ejercicios, rutinas, sesiones, alimentos, recetas, inventario,
 *     ajustes): IndexedDB, detrás del módulo `db`. Solo ese módulo toca el almacén.
 *   - Datos de Home Assistant (báscula y sensores): se leen de hass.states y del
 *     histórico por WebSocket; nunca se duplican como fuente de verdad.
 *   - Datos publicados hacia Home Assistant: helpers input_number, calendario, lista
 *     de tareas, notificaciones y escenas, siempre mediante hass.callService.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, useContext, createContext } from "react";
import { createRoot } from "react-dom/client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, ReferenceLine, Legend,
} from "recharts";
import {
  Home, Dumbbell, Utensils, TrendingUp, Settings, Plus, Check, Timer, ChevronLeft,
  ChevronRight, Trophy, Copy, Trash2, Play, X, Search, Download, Upload, RefreshCw,
  Droplets, Scale, Calendar, AlertTriangle, Pencil, Minus, Flame, ShoppingCart,
  Info, Wifi, WifiOff, ArrowUp, ArrowDown, Library, Layers, BookOpen, Repeat, ArrowUpDown,
  SkipForward, CircleCheck, ListTodo, CalendarDays, Bell, Sparkles,
} from "lucide-react";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/* =============================================================================
 * ESTILOS
 * Todos los colores derivan de variables del frontend de Home Assistant con un
 * respaldo propio (tema oscuro) para cuando la app corre fuera de HA.
 * ========================================================================== */
const CSS = `
entreno-panel{
  --e-bg: var(--primary-background-color, #0B0D10);
  --e-card: var(--card-background-color, #15181D);
  --e-card2: var(--secondary-background-color, #1D2127);
  --e-div: var(--divider-color, #262B33);
  --e-text: var(--primary-text-color, #F2F4F7);
  --e-text2: var(--secondary-text-color, #8B93A1);
  --e-acc: var(--primary-color, var(--accent-color, #4F8CFF));
  --e-ok: var(--success-color, #3DDC97);
  --e-err: var(--error-color, #FF5C5C);
  --e-warn: var(--warning-color, #FFB547);
  --e-font: var(--primary-font-family, Inter, Roboto, system-ui, -apple-system, "Segoe UI", sans-serif);
  --e-acc-soft: color-mix(in srgb, var(--e-acc) 16%, transparent);
  --e-ok-soft: color-mix(in srgb, var(--e-ok) 16%, transparent);
  --e-err-soft: color-mix(in srgb, var(--e-err) 14%, transparent);
  --e-warn-soft: color-mix(in srgb, var(--e-warn) 16%, transparent);
  --e-r-card: 16px; --e-r-btn: 12px;
  display:block; height:100%; min-height:100%;
  background: var(--e-bg); color: var(--e-text);
  font-family: var(--e-font); font-size:15px; line-height:1.4;
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}
entreno-panel.e-standalone{ height:100dvh; }
entreno-panel *, entreno-panel *::before, entreno-panel *::after{ box-sizing:border-box; }
entreno-panel button, entreno-panel input, entreno-panel select, entreno-panel textarea{
  font: inherit; color: inherit; font-variant-numeric: tabular-nums;
}
entreno-panel button{ cursor:pointer; background:none; border:0; padding:0; }
entreno-panel button:focus-visible, entreno-panel input:focus-visible, entreno-panel select:focus-visible{
  outline:2px solid var(--e-acc); outline-offset:2px;
}
entreno-panel ::placeholder{ color: var(--e-text2); opacity:.7; }
entreno-panel h1, entreno-panel h2, entreno-panel h3, entreno-panel p{ margin:0; }

.e-app{ height:100%; display:flex; flex-direction:column; }
.e-main{ flex:1; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; }
.e-page{ max-width:720px; margin:0 auto; padding:16px 16px 32px; display:flex; flex-direction:column; gap:16px; }
.e-page.wide{ max-width:1040px; }
@media (min-width:900px){ .e-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; } }

.e-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:52px; }
.e-header h1{ font-size:22px; font-weight:600; letter-spacing:-.01em; text-wrap:balance; }
.e-header .sub{ color:var(--e-text2); font-size:13px; }
.e-header-actions{ display:flex; gap:6px; }

.e-nav{ flex:none; border-top:1px solid var(--e-div); background: var(--e-card); padding-bottom: env(safe-area-inset-bottom); }
.e-nav-inner{ max-width:720px; margin:0 auto; display:grid; grid-template-columns:repeat(4,1fr); height:64px; }
.e-nav button{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:var(--e-text2); font-size:11px; font-weight:500; letter-spacing:.02em; transition:color .15s; }
.e-nav button.on{ color:var(--e-acc); }
.e-nav button svg{ width:22px; height:22px; }

.e-card{ background:var(--e-card); border-radius:var(--e-r-card); padding:16px; display:flex; flex-direction:column; gap:12px; }
.e-card.flush{ padding:0; overflow:hidden; }
.e-card.accent{ background: var(--e-acc-soft); }
.e-card-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.e-card-title{ font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--e-text2); }
.e-card-title.big{ font-size:17px; text-transform:none; letter-spacing:0; color:var(--e-text); }

.e-big{ font-size:56px; font-weight:600; line-height:1; letter-spacing:-.02em; }
.e-big.md{ font-size:40px; }
.e-big.sm{ font-size:28px; }
.e-unit{ font-size:15px; font-weight:500; color:var(--e-text2); margin-left:4px; }
.e-muted{ color:var(--e-text2); font-size:13px; }
.e-label{ font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--e-text2); }
.e-row{ display:flex; align-items:center; gap:8px; }
.e-row.between{ justify-content:space-between; }
.e-row.wrap{ flex-wrap:wrap; }
.e-col{ display:flex; flex-direction:column; gap:8px; }
.e-stack{ display:flex; flex-direction:column; gap:4px; }
.e-grow{ flex:1; min-width:0; }
.e-right{ text-align:right; }
.e-ellip{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.e-btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:48px; padding:0 18px; border-radius:var(--e-r-btn); font-weight:600; font-size:15px; transition:transform .12s, background .15s, opacity .15s; user-select:none; -webkit-tap-highlight-color:transparent; white-space:nowrap; }
.e-btn:active{ transform:scale(.97); }
.e-btn.primary{ background:var(--e-acc); color:#fff; }
.e-btn.soft{ background:var(--e-acc-soft); color:var(--e-acc); }
.e-btn.ghost{ background:var(--e-card2); color:var(--e-text); }
.e-btn.outline{ border:1px solid var(--e-div); color:var(--e-text); }
.e-btn.danger{ background:var(--e-err-soft); color:var(--e-err); }
.e-btn.ok{ background:var(--e-ok); color:#0B0D10; }
.e-btn.sm{ min-height:36px; padding:0 12px; font-size:13px; border-radius:10px; }
.e-btn.xs{ min-height:30px; padding:0 10px; font-size:12px; border-radius:8px; font-weight:500; }
.e-btn.full{ width:100%; }
.e-btn:disabled{ opacity:.45; cursor:not-allowed; }
.e-btn svg{ width:18px; height:18px; flex:none; }
.e-btn.sm svg, .e-btn.xs svg{ width:16px; height:16px; }
.e-icon-btn{ width:44px; height:44px; border-radius:12px; display:inline-flex; align-items:center; justify-content:center; color:var(--e-text2); transition:background .15s, color .15s; }
.e-icon-btn:hover, .e-icon-btn.on{ background:var(--e-card2); color:var(--e-text); }
.e-icon-btn svg{ width:20px; height:20px; }
.e-icon-btn.sm{ width:36px; height:36px; border-radius:10px; }
.e-icon-btn.sm svg{ width:18px; height:18px; }

.e-chip{ display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 10px; border-radius:999px; font-size:12px; font-weight:500; background:var(--e-card2); color:var(--e-text2); white-space:nowrap; }
.e-chip.acc{ background:var(--e-acc-soft); color:var(--e-acc); }
.e-chip.ok{ background:var(--e-ok-soft); color:var(--e-ok); }
.e-chip.err{ background:var(--e-err-soft); color:var(--e-err); }
.e-chip.warn{ background:var(--e-warn-soft); color:var(--e-warn); }
.e-chip svg{ width:13px; height:13px; }
.e-chips{ display:flex; gap:6px; flex-wrap:wrap; }
.e-chips.scroll{ flex-wrap:nowrap; overflow-x:auto; padding-bottom:2px; scrollbar-width:none; }
.e-chips.scroll::-webkit-scrollbar{ display:none; }
button.e-chip{ height:34px; padding:0 14px; font-size:13px; }
button.e-chip.on{ background:var(--e-acc); color:#fff; }

.e-seg{ display:flex; background:var(--e-card2); border-radius:12px; padding:3px; gap:2px; }
.e-seg button{ flex:1; min-height:38px; border-radius:9px; font-size:13px; font-weight:600; color:var(--e-text2); transition:background .15s, color .15s; }
.e-seg button.on{ background:var(--e-card); color:var(--e-text); box-shadow:0 1px 2px rgba(0,0,0,.3); }

.e-field{ display:flex; flex-direction:column; gap:6px; }
.e-field > label{ font-size:12px; font-weight:600; color:var(--e-text2); letter-spacing:.03em; }
.e-input, .e-select, .e-textarea{ width:100%; min-height:46px; padding:0 14px; border-radius:12px; background:var(--e-card2); border:1px solid transparent; color:var(--e-text); font-size:15px; transition:border-color .15s; }
.e-textarea{ padding:12px 14px; min-height:120px; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
.e-input:focus, .e-select:focus, .e-textarea:focus{ border-color:var(--e-acc); outline:none; }
.e-input.err{ border-color:var(--e-err); }
.e-select{ appearance:none; background-image: linear-gradient(45deg, transparent 50%, var(--e-text2) 50%), linear-gradient(135deg, var(--e-text2) 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size:5px 5px; background-repeat:no-repeat; padding-right:36px; }
.e-select:disabled{ opacity:.5; }
.e-input[type=number]{ -moz-appearance:textfield; }
.e-input::-webkit-outer-spin-button, .e-input::-webkit-inner-spin-button{ -webkit-appearance:none; margin:0; }
.e-fields{ display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:12px; }
.e-toggle{ display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:44px; }
.e-toggle .track{ width:46px; height:28px; border-radius:999px; background:var(--e-card2); position:relative; transition:background .15s; flex:none; border:1px solid var(--e-div); }
.e-toggle .track::after{ content:""; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:var(--e-text2); transition:transform .15s, background .15s; }
.e-toggle.on .track{ background:var(--e-acc); border-color:var(--e-acc); }
.e-toggle.on .track::after{ transform:translateX(18px); background:#fff; }

.e-list{ display:flex; flex-direction:column; }
.e-list > *{ border-top:1px solid var(--e-div); }
.e-list > *:first-child{ border-top:0; }
.e-item{ display:flex; align-items:center; gap:12px; min-height:56px; padding:10px 16px; width:100%; text-align:left; color:inherit; transition:background .12s; }
button.e-item:hover{ background:var(--e-card2); }
.e-item .t{ font-weight:500; }
.e-item .s{ font-size:13px; color:var(--e-text2); }
.e-item .v{ font-weight:600; white-space:nowrap; }

.e-sets{ display:grid; grid-template-columns:28px minmax(0,1fr) minmax(0,1fr) 56px 44px 52px; gap:6px; align-items:center; }
.e-sets .h{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--e-text2); text-align:center; }
.e-set-row{ display:contents; }
.e-set-row .n{ text-align:center; color:var(--e-text2); font-weight:600; font-size:13px; height:52px; display:flex; align-items:center; justify-content:center; gap:2px; }
.e-set-row .n svg{ width:14px; height:14px; color:var(--e-warn); }
.e-cell{ height:52px; border-radius:10px; background:var(--e-card2); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:17px; width:100%; text-align:center; border:1px solid transparent; transition:background .15s, border-color .15s; padding:0 4px; }
.e-cell.ph{ color:var(--e-text2); font-weight:500; }
.e-cell.err{ border-color:var(--e-err); }
.e-cell:focus{ border-color:var(--e-acc); outline:none; }
.e-cell .u{ font-size:11px; color:var(--e-text2); font-weight:500; margin-left:3px; }
.e-set-row.done .e-cell{ background:var(--e-ok-soft); }
.e-check{ height:52px; width:100%; border-radius:10px; background:var(--e-card2); display:flex; align-items:center; justify-content:center; color:var(--e-text2); transition:background .18s, color .18s, transform .18s; }
.e-check.on{ background:var(--e-ok); color:#0B0D10; animation:e-pop .18s ease-out; }
.e-check svg{ width:22px; height:22px; }
@keyframes e-pop{ 0%{transform:scale(.9)} 60%{transform:scale(1.06)} 100%{transform:scale(1)} }
.e-copy{ height:52px; width:100%; border-radius:10px; background:var(--e-card2); display:flex; align-items:center; justify-content:center; color:var(--e-text2); }
.e-copy svg{ width:18px; height:18px; }
.e-copy:hover{ color:var(--e-text); }

.e-sheet-bg{ position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:50; display:flex; align-items:flex-end; justify-content:center; animation:e-fade .15s ease-out; }
.e-sheet{ width:100%; max-width:720px; max-height:92dvh; background:var(--e-card); border-radius:20px 20px 0 0; display:flex; flex-direction:column; animation:e-up .2s ease-out; padding-bottom: env(safe-area-inset-bottom); }
@media (min-width:720px){ .e-sheet-bg{ align-items:center; } .e-sheet{ border-radius:20px; max-height:86vh; } }
.e-sheet-head{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px 8px; gap:8px; }
.e-sheet-head h2{ font-size:17px; font-weight:600; }
.e-sheet-body{ overflow-y:auto; padding:8px 16px 20px; display:flex; flex-direction:column; gap:12px; }
@keyframes e-up{ from{ transform:translateY(24px); opacity:0 } to{ transform:none; opacity:1 } }
@keyframes e-fade{ from{ opacity:0 } to{ opacity:1 } }
@media (prefers-reduced-motion: reduce){ .e-sheet, .e-sheet-bg, .e-check.on{ animation:none; } }

.e-toasts{ position:fixed; left:50%; bottom:88px; transform:translateX(-50%); z-index:60; display:flex; flex-direction:column; gap:8px; width:min(92vw, 480px); pointer-events:none; }
.e-toast{ background:var(--e-card2); color:var(--e-text); border-radius:12px; padding:10px 14px; font-size:13px; display:flex; gap:10px; align-items:flex-start; box-shadow:0 6px 24px rgba(0,0,0,.4); border-left:3px solid var(--e-acc); pointer-events:auto; animation:e-up .2s ease-out; }
.e-toast.err{ border-left-color:var(--e-err); }
.e-toast.ok{ border-left-color:var(--e-ok); }
.e-toast.warn{ border-left-color:var(--e-warn); }
.e-toast svg{ width:16px; height:16px; flex:none; margin-top:1px; }

.e-loads{ display:grid; grid-template-columns:repeat(auto-fill, minmax(96px,1fr)); gap:8px; }
.e-load{ min-height:64px; border-radius:12px; background:var(--e-card2); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; border:1px solid transparent; transition:border-color .12s, background .12s; }
.e-load.on{ border-color:var(--e-acc); background:var(--e-acc-soft); }
.e-load.cur{ border-color:var(--e-div); }
.e-load .kg{ font-size:19px; font-weight:600; }
.e-load .pl{ font-size:11px; color:var(--e-text2); }

.e-timer{ position:fixed; inset:0; z-index:55; background:var(--e-bg); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px; padding:24px; text-align:center; }
.e-timer .t{ font-size:96px; font-weight:600; line-height:1; letter-spacing:-.03em; }
.e-timer .ring{ position:relative; }
.e-timer .ring .t{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:64px; }

.e-week{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.e-week .d{ display:flex; flex-direction:column; align-items:center; gap:6px; font-size:11px; color:var(--e-text2); font-weight:600; }
.e-week .dot{ width:30px; height:30px; border-radius:50%; background:var(--e-card2); display:flex; align-items:center; justify-content:center; color:transparent; }
.e-week .dot.on{ background:var(--e-ok); color:#0B0D10; }
.e-week .dot.today{ box-shadow:0 0 0 2px var(--e-acc); }
.e-week .dot svg{ width:16px; height:16px; }

.e-cal{ display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
.e-cal .wd{ text-align:center; font-size:11px; color:var(--e-text2); font-weight:600; padding:4px 0; }
.e-cal .day{ aspect-ratio:1; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-size:14px; font-weight:500; color:var(--e-text); }
.e-cal .day.out{ color:var(--e-text2); opacity:.4; }
.e-cal .day.today{ box-shadow:inset 0 0 0 2px var(--e-acc); }
.e-cal .day.on{ background:var(--e-ok-soft); color:var(--e-ok); font-weight:600; }
.e-cal .day.sel{ background:var(--e-card2); }
.e-cal .day .m{ width:5px; height:5px; border-radius:50%; background:currentColor; opacity:0; }
.e-cal .day.on .m{ opacity:1; }

.e-bar{ height:8px; border-radius:999px; background:var(--e-card2); overflow:hidden; }
.e-bar > i{ display:block; height:100%; border-radius:999px; background:var(--e-acc); transition:width .3s; }
.e-bar > i.over{ background:var(--e-err); }
.e-macro{ display:flex; flex-direction:column; gap:6px; }
.e-macro .top{ display:flex; justify-content:space-between; font-size:13px; }
.e-macro .top b{ font-weight:600; }

.e-rings{ display:flex; align-items:center; gap:16px; }
.e-ring{ position:relative; display:inline-flex; align-items:center; justify-content:center; flex:none; }
.e-ring .c{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1; }
.e-ring .c b{ font-size:22px; font-weight:600; }
.e-ring .c span{ font-size:11px; color:var(--e-text2); margin-top:3px; }

.e-hero{ display:flex; align-items:baseline; gap:6px; }
.e-trend{ display:inline-flex; align-items:center; gap:2px; font-size:13px; font-weight:600; }
.e-trend svg{ width:14px; height:14px; }
.e-trend.down{ color:var(--e-ok); } .e-trend.up{ color:var(--e-err); } .e-trend.flat{ color:var(--e-text2); }

.e-pr{ display:inline-flex; align-items:center; gap:4px; color:var(--e-warn); font-size:12px; font-weight:600; }
.e-pr svg{ width:14px; height:14px; }
.e-note{ font-size:13px; color:var(--e-text2); display:flex; gap:8px; align-items:flex-start; padding:10px 12px; border-radius:10px; background:var(--e-card2); }
.e-note.acc{ color:var(--e-text); background:var(--e-acc-soft); }
.e-note.err{ background:var(--e-err-soft); color:var(--e-text); }
.e-note.warn{ background:var(--e-warn-soft); color:var(--e-text); }
.e-note svg{ width:16px; height:16px; flex:none; margin-top:1px; color:var(--e-text2); }
.e-note.acc svg{ color:var(--e-acc); } .e-note.err svg{ color:var(--e-err); } .e-note.warn svg{ color:var(--e-warn); }

.e-empty{ padding:32px 16px; text-align:center; color:var(--e-text2); font-size:14px; display:flex; flex-direction:column; align-items:center; gap:10px; }
.e-empty svg{ width:28px; height:28px; opacity:.6; }
.e-table{ width:100%; border-collapse:collapse; font-size:13px; }
.e-table th{ text-align:left; font-weight:600; color:var(--e-text2); font-size:11px; text-transform:uppercase; letter-spacing:.06em; padding:6px 0; border-bottom:1px solid var(--e-div); }
.e-table td{ padding:8px 0; border-bottom:1px solid var(--e-div); }
.e-table td.r, .e-table th.r{ text-align:right; }
.e-chart{ width:100%; height:200px; }
.e-chart.tall{ height:240px; }
.e-tooltip{ background:var(--e-card2); border-radius:10px; padding:8px 10px; font-size:12px; box-shadow:0 4px 16px rgba(0,0,0,.4); }
.e-tooltip b{ font-weight:600; }
.e-countup{ animation:e-fade .4s ease-out; }
.e-kbd{ font-family: ui-monospace, Menlo, monospace; font-size:12px; background:var(--e-card2); padding:2px 6px; border-radius:6px; }
.e-status-dot{ width:8px; height:8px; border-radius:50%; background:var(--e-text2); display:inline-block; }
.e-status-dot.on{ background:var(--e-ok); } .e-status-dot.err{ background:var(--e-err); }
.e-spacer{ flex:1; }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  const s = document.createElement("style");
  s.id = "entreno-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
  stylesInjected = true;
}

/* =============================================================================
 * UTILIDADES
 * ========================================================================== */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const weekStart = (s) => { const d = parseISO(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoOf(d); };
const DAYS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fmtDate = (s, withYear = false) => { const d = parseISO(s); return `${DAYS_ES[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)}${withYear ? " " + d.getFullYear() : ""}`; };
const fmtDateShort = (s) => { const d = parseISO(s); return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)}`; };
const r1 = (x) => Math.round(x * 10) / 10;
const fmtKg = (x) => (Number.isInteger(r1(x)) ? String(r1(x)) : r1(x).toFixed(1).replace(".", ","));
const fmtN = (x, d = 0) => (x == null || Number.isNaN(x) ? "–" : Number(x).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const fmtSecs = (s) => `${Math.floor(s / 60)}:${pad2(s % 60)}`;
const num = (v, fallback = 0) => { const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : fallback; };

/* =============================================================================
 * CAPA DE DATOS · IndexedDB
 * Único módulo con acceso al almacén. Si IndexedDB no está disponible se usa una
 * copia en memoria (la app sigue funcionando, sin persistencia).
 * ========================================================================== */
const DB_NAME = "entreno";
const DB_VERSION = 1;
const STORES = {
  settings: "key", inventory: "key", exercises: "id", routines: "id", sessions: "id",
  foods: "id", recipes: "id", diary: "date", bodyweight: "date", haQueue: "id",
};

const db = (() => {
  let dbp = null;
  const memory = Object.fromEntries(Object.keys(STORES).map((s) => [s, new Map()]));
  let useMemory = typeof indexedDB === "undefined";

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { useMemory = true; return resolve(null); }
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { useMemory = true; resolve(null); };
      req.onblocked = () => reject(new Error("IndexedDB bloqueada"));
    });
    return dbp;
  }
  const tx = (d, store, mode, fn) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

  return {
    get usesMemory() { return useMemory; },
    async getAll(store) {
      const d = await open();
      if (!d || useMemory) return [...memory[store].values()];
      return tx(d, store, "readonly", (s) => s.getAll());
    },
    async put(store, rec) {
      const d = await open();
      memory[store].set(rec[STORES[store]], rec);
      if (!d || useMemory) return;
      await tx(d, store, "readwrite", (s) => s.put(rec));
    },
    async putMany(store, recs) {
      const d = await open();
      recs.forEach((r) => memory[store].set(r[STORES[store]], r));
      if (!d || useMemory) return;
      await tx(d, store, "readwrite", (s) => { recs.forEach((r) => s.put(r)); return null; });
    },
    async del(store, key) {
      const d = await open();
      memory[store].delete(key);
      if (!d || useMemory) return;
      await tx(d, store, "readwrite", (s) => s.delete(key));
    },
    async clear(store) {
      const d = await open();
      memory[store].clear();
      if (!d || useMemory) return;
      await tx(d, store, "readwrite", (s) => s.clear());
    },
    async loadAll() {
      const out = {};
      for (const s of Object.keys(STORES)) out[s] = await this.getAll(s);
      return out;
    },
    async exportAll() {
      const data = await this.loadAll();
      return { app: "entreno", version: APP_VERSION, exportedAt: new Date().toISOString(), data };
    },
    async importAll(payload) {
      if (!payload || payload.app !== "entreno" || !payload.data) throw new Error("El JSON no es una exportación de Entreno");
      for (const s of Object.keys(STORES)) {
        await this.clear(s);
        if (Array.isArray(payload.data[s])) await this.putMany(s, payload.data[s]);
      }
    },
  };
})();

/* =============================================================================
 * DATOS DE EJEMPLO Y VALORES POR DEFECTO
 * Solo material disponible: banco inclinable, barra olímpica, dos barras de
 * mancuerna, discos (10×4, 5×4, 1,5×4), kettlebell de 10 kg y peso corporal.
 * ========================================================================== */
const MUSCLES = ["pecho", "espalda", "hombro", "bíceps", "tríceps", "cuádriceps", "isquios", "glúteo", "gemelo", "core"];
const LOAD_MODES = {
  barbell: { label: "Barra olímpica", implement: "barbell", unit: "kg en barra", tonnageX: 1 },
  pair: { label: "Par de mancuernas", implement: "dumbbells", unit: "kg por mancuerna", tonnageX: 2 },
  single: { label: "Una mancuerna", implement: "dumbbells", unit: "kg por mancuerna", tonnageX: 1 },
  kettlebell: { label: "Kettlebell", implement: null, unit: "kg", tonnageX: 1 },
  bodyweight: { label: "Peso corporal", implement: null, unit: "kg de lastre", tonnageX: 1 },
};
const EQUIPMENT_LABEL = {
  barbell: "Barra olímpica", pair: "2 mancuernas", single: "1 mancuerna", kettlebell: "Kettlebell", bodyweight: "Peso corporal",
};

const EX = (id, name, muscle, secondary, loadMode, opts, notes) => ({
  id, name, muscle, secondary, loadMode, bench: !!opts.bench, unilateral: !!opts.uni, lower: !!opts.lower,
  restSec: opts.rest ?? (opts.lower ? 150 : 90), notes,
});
const SEED_EXERCISES = [
  // Pecho
  EX("press_banca", "Press de banca plano", "pecho", ["tríceps", "hombro"], "barbell", { bench: true, rest: 150 }, "Escápulas retraídas y apoyadas en el banco, pies firmes. Baja la barra al esternón con control y empuja en línea recta. Sin rack: siéntate con la barra sobre los muslos, túmbate y llévala al pecho con impulso (roll-of-shame inverso)."),
  EX("press_inclinado", "Press inclinado con barra", "pecho", ["hombro", "tríceps"], "barbell", { bench: true, rest: 150 }, "Banco a 30°. La barra baja a la parte alta del pecho, codos a 45°. Menos carga que en plano; prioriza rango completo."),
  EX("press_declinado", "Press declinado con barra", "pecho", ["tríceps"], "barbell", { bench: true, rest: 150 }, "Banco a −15°. Engancha los pies. Recorrido corto y fuerte; controla la fase excéntrica."),
  EX("press_mancuernas", "Press plano con mancuernas", "pecho", ["tríceps", "hombro"], "pair", { bench: true, rest: 120 }, "Sube las mancuernas con las rodillas, baja hasta que los codos queden bajo la línea del banco. Junta arriba sin chocar."),
  EX("press_inclinado_mancuernas", "Press inclinado con mancuernas", "pecho", ["hombro", "tríceps"], "pair", { bench: true, rest: 120 }, "Banco a 30-45°. Mayor recorrido que con barra. Codos ligeramente abiertos."),
  EX("aperturas", "Aperturas con mancuernas", "pecho", [], "pair", { bench: true, rest: 75 }, "Codos ligeramente flexionados y fijos. Estira sin perder tensión; no bajes más de la línea del hombro."),
  EX("flexiones", "Flexiones", "pecho", ["tríceps", "core"], "bodyweight", { rest: 75 }, "Cuerpo en línea, manos algo más abiertas que los hombros. Pecho al suelo. Lastre: disco sobre la espalda alta o pies en el banco."),
  EX("flexiones_declinadas", "Flexiones con pies en banco", "pecho", ["hombro", "tríceps"], "bodyweight", { bench: true, rest: 75 }, "Pies sobre el banco. Más énfasis en pectoral superior y hombro. Mantén la cadera alineada."),
  EX("pullover", "Pullover con mancuerna", "pecho", ["espalda"], "single", { bench: true, rest: 90 }, "Tumbado transversal en el banco, cadera baja. Mancuerna con ambas manos, codos casi fijos, estira por detrás de la cabeza."),
  // Espalda
  EX("remo_barra", "Remo con barra", "espalda", ["bíceps"], "barbell", { rest: 120 }, "Bisagra de cadera a unos 45°, espalda neutra. Tira hacia el ombligo llevando los codos atrás. Sin balanceo."),
  EX("remo_mancuerna", "Remo a una mano con mancuerna", "espalda", ["bíceps"], "single", { bench: true, uni: true, rest: 90 }, "Mano y rodilla en el banco. Tira con el codo pegado, pausa arriba un segundo. Sin rotar el torso."),
  EX("remo_apoyado", "Remo con pecho apoyado en banco", "espalda", ["bíceps", "hombro"], "pair", { bench: true, rest: 90 }, "Banco a 30-45°, pecho apoyado. Rema con ambas mancuernas, codos a 45°. Aísla la espalda sin carga lumbar."),
  EX("peso_muerto", "Peso muerto convencional", "espalda", ["glúteo", "isquios"], "barbell", { lower: true, rest: 180 }, "Barra sobre el mediopié, espalda neutra, empuja el suelo. Bloquea con glúteo, no con lumbar. Con discos pequeños la barra queda más baja: eleva los discos si hace falta."),
  EX("peso_muerto_rumano", "Peso muerto rumano con barra", "isquios", ["glúteo", "espalda"], "barbell", { lower: true, rest: 150 }, "Rodillas casi extendidas, cadera atrás, barra pegada a las piernas. Baja hasta notar tensión en isquios. Tempo 3 s de bajada."),
  EX("remo_kettlebell", "Remo con kettlebell", "espalda", ["bíceps"], "kettlebell", { uni: true, rest: 60 }, "Igual que el remo a una mano. Útil para series altas o calentamiento."),
  EX("encogimientos", "Encogimientos con barra", "espalda", [], "barbell", { rest: 75 }, "Barra delante, hombros hacia las orejas, pausa 1 s arriba. Sin rotar los hombros."),
  EX("superman", "Extensión lumbar en banco", "espalda", ["glúteo"], "bodyweight", { bench: true, rest: 60 }, "Cadera al borde del banco, pies sujetos bajo un disco o por el propio banco. Extiende hasta la línea del cuerpo, sin hiperextender."),
  // Hombro
  EX("press_militar", "Press militar con barra", "hombro", ["tríceps"], "barbell", { rest: 150 }, "De pie, barra desde clavículas. Glúteo y core firmes, cabeza atrás y luego bajo la barra. Sin rack: limpia la barra desde el suelo."),
  EX("press_hombro_mancuernas", "Press de hombro con mancuernas", "hombro", ["tríceps"], "pair", { bench: true, rest: 120 }, "Sentado con respaldo a 80-90°. Codos ligeramente adelante. Baja hasta la oreja."),
  EX("press_arnold", "Press Arnold", "hombro", ["tríceps"], "pair", { bench: true, rest: 90 }, "Empieza con palmas hacia ti y rota mientras subes. Carga menor que el press normal."),
  EX("elevaciones_laterales", "Elevaciones laterales", "hombro", [], "pair", { rest: 60 }, "Codos ligeramente flexionados, sube hasta la horizontal guiando con los codos. Baja en 2-3 s. Con 2 kg de barra las series serán altas: 15-20 reps."),
  EX("elevaciones_frontales_disco", "Elevaciones frontales con disco", "hombro", [], "bodyweight", { rest: 60 }, "Disco sujeto con ambas manos. Sube hasta la altura de los ojos sin balanceo. Lastre = peso del disco."),
  EX("pajaros", "Pájaros con mancuernas", "hombro", ["espalda"], "pair", { bench: true, rest: 60 }, "Sentado en el borde del banco inclinado hacia delante o con pecho apoyado. Abre con codos ligeramente flexionados, pausa arriba."),
  EX("remo_menton", "Remo al mentón con barra", "hombro", ["espalda"], "barbell", { rest: 75 }, "Agarre ancho (más que los hombros) para proteger el hombro. Codos guían por encima de la barra, hasta el pecho."),
  // Bíceps
  EX("curl_barra", "Curl con barra", "bíceps", [], "barbell", { rest: 75 }, "Codos pegados al torso, sin balanceo. Baja completamente en 2-3 s."),
  EX("curl_alterno", "Curl alterno con mancuernas", "bíceps", [], "pair", { rest: 60 }, "Supina la muñeca durante la subida. Alterna brazos sin impulso de cadera."),
  EX("curl_martillo", "Curl martillo", "bíceps", [], "pair", { rest: 60 }, "Agarre neutro. Trabaja braquial y antebrazo. Mismas reglas de control."),
  EX("curl_inclinado", "Curl inclinado en banco", "bíceps", [], "pair", { bench: true, rest: 75 }, "Banco a 45-60°, brazos colgando atrás. Máximo estiramiento; no subas los codos."),
  EX("curl_concentrado", "Curl concentrado", "bíceps", [], "single", { bench: true, uni: true, rest: 60 }, "Sentado en el banco, codo apoyado en el interior del muslo. Contracción máxima arriba."),
  // Tríceps
  EX("press_frances", "Press francés con barra", "tríceps", [], "barbell", { bench: true, rest: 90 }, "Tumbado, baja la barra a la frente o detrás de la cabeza. Codos apuntando al techo y fijos."),
  EX("extension_triceps_mancuerna", "Extensión de tríceps sobre la cabeza", "tríceps", [], "single", { bench: true, rest: 75 }, "Sentado, mancuerna con las dos manos. Codos cerca de las orejas, baja hasta 90° o más."),
  EX("fondos_banco", "Fondos en banco", "tríceps", ["pecho", "hombro"], "bodyweight", { bench: true, rest: 75 }, "Manos en el borde del banco, pies en el suelo o elevados. Baja hasta 90° en el codo. Lastre: disco sobre los muslos."),
  EX("press_cerrado", "Press de banca cerrado", "tríceps", ["pecho"], "barbell", { bench: true, rest: 120 }, "Agarre a la anchura de los hombros. Codos cerrados, barra a la parte baja del pecho."),
  EX("patada_triceps", "Patada de tríceps", "tríceps", [], "pair", { bench: true, rest: 60 }, "Torso paralelo al suelo, codo alto y fijo. Extiende del todo y aprieta 1 s."),
  // Cuádriceps
  EX("sentadilla_frontal", "Sentadilla frontal con barra", "cuádriceps", ["glúteo", "core"], "barbell", { lower: true, rest: 180 }, "Sin rack: limpia la barra a los hombros. Codos altos, torso vertical, baja todo lo que la movilidad permita. Sube la dificultad con tempo 3-1-1 o pausa abajo antes que con kilos."),
  EX("sentadilla_trasera", "Sentadilla trasera con barra", "cuádriceps", ["glúteo", "isquios"], "barbell", { lower: true, rest: 180 }, "Sin rack hay que pasar la barra por encima de la cabeza (limpia + press tras nuca), así que la carga útil está limitada por lo que puedas presionar. Usa esta variante con cargas moderadas y tempo."),
  EX("sentadilla_goblet", "Sentadilla goblet", "cuádriceps", ["glúteo", "core"], "kettlebell", { lower: true, rest: 120 }, "Kettlebell pegada al pecho, codos entre las rodillas al bajar. Ideal para calentar y para series de 15-20 con pausa abajo."),
  EX("sentadilla_bulgara", "Sentadilla búlgara", "cuádriceps", ["glúteo"], "pair", { bench: true, uni: true, lower: true, rest: 120 }, "Pie trasero sobre el banco. Torso ligeramente inclinado, rodilla delantera sigue la punta del pie. Progresión de tren inferior de referencia con mancuernas."),
  EX("zancadas", "Zancadas con mancuernas", "cuádriceps", ["glúteo"], "pair", { uni: true, lower: true, rest: 120 }, "Paso largo, rodilla trasera cerca del suelo. Alterna o completa una pierna primero."),
  EX("zancada_inversa_barra", "Zancada inversa con barra", "cuádriceps", ["glúteo"], "barbell", { uni: true, lower: true, rest: 150 }, "Barra en la espalda (limpia y press tras nuca) o al frente. Paso atrás controlado, empuja con el talón delantero."),
  EX("step_up", "Subida al banco", "cuádriceps", ["glúteo"], "pair", { bench: true, uni: true, lower: true, rest: 90 }, "Banco plano. Sube empujando con la pierna de arriba, sin impulso de la de abajo. Baja en 2-3 s."),
  EX("sentadilla_mancuernas", "Sentadilla con mancuernas a los lados", "cuádriceps", ["glúteo"], "pair", { lower: true, rest: 120 }, "Mancuernas colgando a los lados, torso erguido. Rango completo. Buena opción cuando los discos están en la barra."),
  // Isquios y glúteo
  EX("rdl_mancuernas", "Peso muerto rumano con mancuernas", "isquios", ["glúteo"], "pair", { lower: true, rest: 120 }, "Igual que con barra, mancuernas pegadas a los muslos. Bajada lenta."),
  EX("hip_thrust", "Hip thrust con barra", "glúteo", ["isquios"], "barbell", { bench: true, lower: true, rest: 120 }, "Espalda alta apoyada en el banco, barra sobre la cadera (usa una toalla). Sube hasta cadera extendida, pausa 2 s. Mentón abajo."),
  EX("puente_gluteo_una_pierna", "Puente de glúteo a una pierna", "glúteo", ["isquios"], "bodyweight", { bench: true, uni: true, lower: true, rest: 60 }, "Espalda en el banco o en el suelo, una pierna elevada. Pausa arriba. Lastre: disco sobre la cadera."),
  EX("buenos_dias", "Buenos días con barra", "isquios", ["glúteo", "espalda"], "barbell", { lower: true, rest: 120 }, "Barra en la espalda, bisagra de cadera con rodillas suaves. Carga moderada; mucha tensión en isquios con poco peso."),
  EX("pm_una_pierna", "Peso muerto a una pierna", "isquios", ["glúteo", "core"], "single", { uni: true, lower: true, rest: 90 }, "Mancuerna en la mano contraria a la pierna de apoyo. Cadera cuadrada, espalda neutra. Equilibrio y control."),
  EX("swing_kb", "Swing con kettlebell", "glúteo", ["isquios", "core"], "kettlebell", { lower: true, rest: 60 }, "Bisagra explosiva de cadera; los brazos solo guían. Series de 15-25 como acondicionamiento."),
  EX("curl_nordico", "Curl nórdico", "isquios", [], "bodyweight", { bench: true, lower: true, rest: 120 }, "Talones sujetos bajo el banco o un disco pesado. Baja lo más lento posible, ayúdate con las manos para subir."),
  // Gemelo
  EX("gemelo_pie", "Elevación de talones de pie", "gemelo", [], "pair", { lower: true, rest: 60 }, "Punta del pie sobre un disco para ganar rango, mancuernas a los lados. Pausa 1 s arriba y 2 s de estiramiento abajo."),
  EX("gemelo_una_pierna", "Elevación de talones a una pierna", "gemelo", [], "single", { uni: true, lower: true, rest: 60 }, "Apóyate en el banco con la mano libre. Rango completo."),
  // Core
  EX("plancha", "Plancha", "core", [], "bodyweight", { rest: 60 }, "Codos bajo los hombros, glúteo apretado. Registra segundos en la casilla de repeticiones. Lastre: disco en la espalda."),
  EX("plancha_lateral", "Plancha lateral", "core", [], "bodyweight", { uni: true, rest: 45 }, "Cadera alta, cuerpo en línea. Segundos por lado en la casilla de repeticiones."),
  EX("crunch_declinado", "Crunch en banco declinado", "core", [], "bodyweight", { bench: true, rest: 60 }, "Pies enganchados, baja el torso controlado. Lastre: disco sobre el pecho."),
  EX("elevacion_piernas_banco", "Elevación de piernas en banco", "core", [], "bodyweight", { bench: true, rest: 60 }, "Tumbado en el banco, manos sujetas al cabecero. Sube las piernas y levanta la cadera al final."),
  EX("paseo_granjero", "Paseo del granjero", "core", ["espalda"], "pair", { rest: 90 }, "Mancuernas pesadas a los lados, hombros atrás. Registra metros o segundos en repeticiones."),
  EX("russian_twist", "Giro ruso con disco", "core", [], "bodyweight", { rest: 60 }, "Sentado, pies elevados. Gira el torso, no solo los brazos. Lastre = disco."),
  EX("dead_bug", "Dead bug", "core", [], "bodyweight", { rest: 45 }, "Lumbar pegada al suelo. Extiende brazo y pierna contrarios sin perder el contacto."),
];

const B = (exerciseId, sets, repsMin, repsMax, restSec) => ({ exerciseId, sets, repsMin, repsMax, restSec });
const SEED_ROUTINES = [
  {
    id: "rt_torso_pierna", name: "Torso / Pierna · 5 días",
    description: "Cuatro sesiones torso/pierna y una quinta de cuerpo completo para cerrar la semana.",
    days: [
      { name: "Torso A", blocks: [B("press_banca", 4, 6, 8, 150), B("remo_barra", 4, 6, 8, 120), B("press_hombro_mancuernas", 3, 8, 12, 120), B("remo_mancuerna", 3, 8, 12, 90), B("curl_barra", 3, 10, 12, 75), B("press_frances", 3, 10, 12, 90)] },
      { name: "Pierna A", blocks: [B("sentadilla_frontal", 4, 6, 8, 180), B("peso_muerto_rumano", 3, 8, 10, 150), B("sentadilla_bulgara", 3, 8, 12, 120), B("hip_thrust", 3, 10, 12, 120), B("gemelo_pie", 4, 12, 15, 60), B("plancha", 3, 40, 60, 60)] },
      { name: "Torso B", blocks: [B("press_inclinado_mancuernas", 4, 8, 12, 120), B("remo_apoyado", 4, 8, 12, 90), B("press_militar", 3, 6, 8, 150), B("elevaciones_laterales", 3, 15, 20, 60), B("curl_inclinado", 3, 10, 12, 75), B("fondos_banco", 3, 10, 15, 75)] },
      { name: "Pierna B", blocks: [B("peso_muerto", 4, 5, 6, 180), B("zancadas", 3, 8, 12, 120), B("sentadilla_goblet", 3, 12, 15, 120), B("rdl_mancuernas", 3, 10, 12, 120), B("gemelo_una_pierna", 3, 12, 15, 60), B("elevacion_piernas_banco", 3, 10, 15, 60)] },
      { name: "Cuerpo completo", blocks: [B("swing_kb", 4, 15, 20, 60), B("press_mancuernas", 3, 8, 12, 120), B("remo_kettlebell", 3, 12, 15, 60), B("step_up", 3, 10, 12, 90), B("pajaros", 3, 12, 15, 60), B("paseo_granjero", 3, 30, 40, 90)] },
    ],
  },
  {
    id: "rt_ppl", name: "Push · Pull · Legs",
    description: "Tres sesiones rotativas. Con cinco días de entreno se encadenan sin importar la semana.",
    days: [
      { name: "Push", blocks: [B("press_banca", 4, 6, 8, 150), B("press_inclinado_mancuernas", 3, 8, 12, 120), B("press_militar", 3, 6, 8, 150), B("elevaciones_laterales", 4, 15, 20, 60), B("press_frances", 3, 10, 12, 90), B("flexiones", 2, 12, 20, 75)] },
      { name: "Pull", blocks: [B("peso_muerto", 3, 5, 6, 180), B("remo_barra", 4, 6, 8, 120), B("remo_mancuerna", 3, 10, 12, 90), B("pajaros", 3, 12, 15, 60), B("curl_barra", 3, 8, 12, 75), B("curl_martillo", 2, 10, 12, 60)] },
      { name: "Legs", blocks: [B("sentadilla_frontal", 4, 6, 8, 180), B("peso_muerto_rumano", 3, 8, 10, 150), B("sentadilla_bulgara", 3, 8, 12, 120), B("hip_thrust", 3, 10, 12, 120), B("gemelo_pie", 4, 12, 15, 60), B("crunch_declinado", 3, 12, 15, 60)] },
    ],
  },
  {
    id: "rt_fullbody", name: "Full Body · 3 días",
    description: "Tres sesiones de cuerpo completo con un básico distinto en cada una.",
    days: [
      { name: "Full A", blocks: [B("sentadilla_frontal", 3, 6, 8, 180), B("press_banca", 3, 6, 8, 150), B("remo_barra", 3, 8, 10, 120), B("elevaciones_laterales", 3, 15, 20, 60), B("plancha", 3, 40, 60, 60)] },
      { name: "Full B", blocks: [B("peso_muerto", 3, 5, 6, 180), B("press_militar", 3, 6, 8, 150), B("remo_apoyado", 3, 10, 12, 90), B("sentadilla_bulgara", 3, 8, 12, 120), B("curl_barra", 2, 10, 12, 75)] },
      { name: "Full C", blocks: [B("hip_thrust", 3, 10, 12, 120), B("press_inclinado_mancuernas", 3, 8, 12, 120), B("remo_mancuerna", 3, 10, 12, 90), B("zancadas", 3, 8, 12, 120), B("fondos_banco", 3, 10, 15, 75)] },
    ],
  },
];

const F = (id, name, per, kcal, protein, carbs, fat, unitLabel) => ({ id, name, per, kcal, protein, carbs, fat, unitLabel: unitLabel || "" });
const SEED_FOODS = [
  F("pollo", "Pechuga de pollo (cruda)", "100g", 110, 23, 0, 1.5),
  F("pavo_fiambre", "Pavo fiambre", "100g", 105, 20, 2, 2),
  F("ternera", "Ternera magra", "100g", 130, 21, 0, 5),
  F("merluza", "Merluza", "100g", 85, 17, 0, 2),
  F("salmon", "Salmón", "100g", 200, 20, 0, 13),
  F("atun_lata", "Atún al natural (lata)", "unit", 70, 16, 0, 1, "lata 56 g"),
  F("huevo", "Huevo", "unit", 75, 6.5, 0.5, 5.5, "unidad M"),
  F("clara", "Clara de huevo", "unit", 17, 3.6, 0.2, 0, "unidad"),
  F("yogur_griego", "Yogur griego 0 %", "unit", 60, 10, 4, 0.2, "tarrina 125 g"),
  F("queso_batido", "Queso fresco batido 0 %", "100g", 47, 8, 4, 0.2),
  F("leche_desnatada", "Leche desnatada", "100g", 34, 3.4, 4.8, 0.1),
  F("whey", "Proteína whey", "unit", 115, 24, 2, 1.5, "cazo 30 g"),
  F("avena", "Copos de avena", "100g", 370, 13, 60, 7),
  F("arroz", "Arroz blanco cocido", "100g", 130, 2.7, 28, 0.3),
  F("pasta", "Pasta cocida", "100g", 155, 5.5, 30, 1),
  F("patata", "Patata cocida", "100g", 85, 2, 19, 0.1),
  F("pan_integral", "Pan integral", "unit", 70, 3, 12, 1, "rebanada 30 g"),
  F("tortita_arroz", "Tortita de arroz", "unit", 35, 0.7, 7.5, 0.3, "unidad"),
  F("lentejas", "Lentejas cocidas", "100g", 115, 9, 17, 0.5),
  F("garbanzos", "Garbanzos cocidos", "100g", 140, 8, 20, 2.5),
  F("platano", "Plátano", "unit", 105, 1.3, 27, 0.4, "unidad 120 g"),
  F("manzana", "Manzana", "unit", 80, 0.4, 21, 0.2, "unidad 150 g"),
  F("naranja", "Naranja", "unit", 65, 1.2, 15, 0.2, "unidad 150 g"),
  F("aguacate", "Aguacate", "100g", 160, 2, 9, 15),
  F("aceite", "Aceite de oliva virgen", "100g", 884, 0, 0, 100),
  F("almendras", "Almendras", "100g", 580, 21, 22, 50),
  F("brocoli", "Brócoli", "100g", 34, 2.8, 7, 0.4),
  F("tomate", "Tomate", "100g", 18, 0.9, 3.9, 0.2),
  F("ensalada", "Ensalada mixta (lechuga, tomate, cebolla)", "100g", 20, 1, 4, 0.2),
  F("jamon_serrano", "Jamón serrano", "100g", 240, 30, 0, 13),
  F("chocolate_85", "Chocolate negro 85 %", "unit", 60, 1, 2, 5, "onza 10 g"),
  F("cafe_leche", "Café con leche desnatada", "unit", 40, 3.5, 5, 0.1, "taza 200 ml"),
];
const SEED_RECIPES = [
  { id: "rc_avena", name: "Bol de avena con proteína", servings: 1, items: [{ foodId: "avena", qty: 60 }, { foodId: "leche_desnatada", qty: 250 }, { foodId: "whey", qty: 1 }, { foodId: "platano", qty: 1 }] },
  { id: "rc_pollo_arroz", name: "Pollo con arroz y brócoli", servings: 1, items: [{ foodId: "pollo", qty: 200 }, { foodId: "arroz", qty: 250 }, { foodId: "brocoli", qty: 150 }, { foodId: "aceite", qty: 10 }] },
];

const DEFAULT_SETTINGS = {
  key: "app",
  barbellKg: 20, dumbbellBarKg: 2, restDefaultSec: 90,
  activeRoutineId: "rt_torso_pierna",
  profile: { heightCm: 173, daysPerWeek: 5, level: "intermedio", goal: "Pérdida de grasa" },
  goals: { kcal: 2200, protein: 190, carbs: 210, fat: 65, waterMl: 3000 },
  ha: {
    enabled: false,
    scaleEntity: "", calendarEntity: "", todoEntity: "",
    notifyService: "", notifyOnRest: false,
    ttsService: "", ttsEntity: "", mediaPlayerEntity: "",
    sceneStart: "", sceneEnd: "",
    helpers: { weeklyVolume: "", weeklySessions: "", adherence: "", dayTonnage: "", proteinLeft: "" },
  },
  seeded: true,
};
const DEFAULT_INVENTORY = {
  key: "main",
  plates: [{ kg: 10, count: 4 }, { kg: 5, count: 4 }, { kg: 1.5, count: 4 }],
  bars: { olympic: 1, dumbbell: 2 },
  kettlebells: [{ kg: 10, count: 1 }],
  bench: { incline: true, decline: true },
};

// Sesiones históricas de ejemplo (fechas relativas a hoy).
function seedSessions() {
  const t = todayISO();
  const S = (kg, reps, rir, pr = false) => ({ kg, reps, rir, done: true, pr });
  const mk = (id, date, dayIndex, dayName, startH, mins, exercises) => ({
    id, date, routineId: "rt_torso_pierna", dayIndex, dayName,
    startedAt: new Date(parseISO(date).getTime() + startH * 3600e3).toISOString(),
    finishedAt: new Date(parseISO(date).getTime() + startH * 3600e3 + mins * 60e3).toISOString(),
    exercises, mounted: { barbell: null, dumbbells: null }, note: "",
  });
  return [
    mk("ss_seed_1", addDays(t, -9), 0, "Torso A", 18, 62, [
      { exerciseId: "press_banca", restSec: 150, sets: [S(50, 8, 2), S(50, 8, 2), S(50, 7, 1), S(50, 7, 1)] },
      { exerciseId: "remo_barra", restSec: 120, sets: [S(46, 8, 2), S(46, 8, 2), S(46, 8, 1), S(46, 7, 1)] },
      { exerciseId: "press_hombro_mancuernas", restSec: 120, sets: [S(15, 10, 2), S(15, 10, 2), S(15, 9, 1)] },
      { exerciseId: "remo_mancuerna", restSec: 90, sets: [S(22, 10, 2), S(22, 10, 2), S(22, 10, 1)] },
      { exerciseId: "curl_barra", restSec: 75, sets: [S(26, 10, 2), S(26, 10, 1), S(26, 9, 0)] },
      { exerciseId: "press_frances", restSec: 90, sets: [S(23, 12, 2), S(23, 11, 1), S(23, 10, 1)] },
    ]),
    mk("ss_seed_2", addDays(t, -7), 1, "Pierna A", 18, 66, [
      { exerciseId: "sentadilla_frontal", restSec: 180, sets: [S(50, 8, 2), S(50, 8, 2), S(50, 8, 1), S(50, 7, 1)] },
      { exerciseId: "peso_muerto_rumano", restSec: 150, sets: [S(60, 10, 2), S(60, 10, 2), S(60, 9, 1)] },
      { exerciseId: "sentadilla_bulgara", restSec: 120, sets: [S(12, 10, 2), S(12, 10, 2), S(12, 10, 1)] },
      { exerciseId: "hip_thrust", restSec: 120, sets: [S(66, 12, 2), S(66, 12, 2), S(66, 11, 1)] },
      { exerciseId: "gemelo_pie", restSec: 60, sets: [S(15, 15, 2), S(15, 15, 2), S(15, 14, 1), S(15, 12, 0)] },
      { exerciseId: "plancha", restSec: 60, sets: [S(0, 45, 2), S(0, 45, 1), S(0, 40, 0)] },
    ]),
    mk("ss_seed_3", addDays(t, -2), 0, "Torso A", 18, 60, [
      { exerciseId: "press_banca", restSec: 150, sets: [S(50, 8, 2), S(50, 8, 2), S(50, 8, 1), S(50, 8, 1, true)] },
      { exerciseId: "remo_barra", restSec: 120, sets: [S(46, 8, 2), S(46, 8, 2), S(46, 8, 1), S(46, 8, 1)] },
      { exerciseId: "press_hombro_mancuernas", restSec: 120, sets: [S(15, 11, 2), S(15, 10, 1), S(15, 10, 1)] },
      { exerciseId: "remo_mancuerna", restSec: 90, sets: [S(22, 12, 2), S(22, 11, 1), S(22, 10, 1)] },
      { exerciseId: "curl_barra", restSec: 75, sets: [S(26, 11, 2), S(26, 10, 1), S(26, 10, 0)] },
      { exerciseId: "press_frances", restSec: 90, sets: [S(23, 12, 2), S(23, 12, 1), S(23, 11, 1)] },
    ]),
  ];
}
function seedDiary() {
  const t = todayISO();
  return [{
    date: t,
    meals: {
      desayuno: [{ recipeId: "rc_avena", qty: 1 }, { foodId: "cafe_leche", qty: 1 }],
      comida: [{ recipeId: "rc_pollo_arroz", qty: 1 }],
      cena: [{ foodId: "merluza", qty: 200 }, { foodId: "ensalada", qty: 150 }, { foodId: "aceite", qty: 8 }, { foodId: "pan_integral", qty: 1 }],
      snacks: [{ foodId: "yogur_griego", qty: 1 }, { foodId: "manzana", qty: 1 }],
    },
    waterMl: 1500,
  }];
}
function seedBodyweight() {
  const t = todayISO();
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 30; i >= 0; i--) {
    if (i % 5 === 3) continue; // días sin pesarse
    const base = 117.9 - (30 - i) * 0.06;
    out.push({ date: addDays(t, -i), kg: r1(base + (rnd() - 0.5) * 0.9), source: "manual" });
  }
  out[out.length - 1].kg = 116.0;
  return out;
}

/* =============================================================================
 * CÁLCULO DE CARGAS MONTABLES
 * Los discos son un recurso compartido: lo montado en la barra no está disponible
 * para las mancuernas y viceversa.
 * ========================================================================== */

// Discos libres tras descontar los ocupados en otros implementos: {kg: count}
function freePlates(inventory, occupied = {}) {
  return inventory.plates
    .map((p) => ({ kg: p.kg, count: Math.max(0, p.count - (occupied[p.kg] || 0)) }))
    .filter((p) => p.count > 0);
}

// Enumera todas las cargas simétricas. groupSize = 2 (barra o una mancuerna:
// cada tipo de disco va en pares) o 4 (par de mancuernas: cada tipo va de
// cuatro en cuatro, dos por mancuerna). Devuelve [{kg, side:[{kg,n}], nPlates}].
function enumerateLoads(plates, barKg, groupSize) {
  const types = plates
    .map((p) => ({ kg: p.kg, groups: Math.floor(p.count / groupSize) }))
    .filter((p) => p.groups > 0)
    .sort((a, b) => b.kg - a.kg);
  const best = new Map(); // total → combinación con menos discos
  const walk = (i, side, sideKg, nPlates) => {
    if (i === types.length) {
      const total = r1(barKg + 2 * sideKg);
      const prev = best.get(total);
      if (!prev || nPlates < prev.nPlates) best.set(total, { kg: total, side: side.filter((s) => s.n > 0), nPlates });
      return;
    }
    for (let n = 0; n <= types[i].groups; n++) {
      walk(i + 1, [...side, { kg: types[i].kg, n }], sideKg + n * types[i].kg, nPlates + n);
    }
  };
  walk(0, [], 0, 0);
  return [...best.values()].sort((a, b) => a.kg - b.kg);
}

// Discos ocupados por lo montado en los demás implementos.
function occupiedBy(mounted, exceptImplement) {
  const occ = {};
  for (const [impl, m] of Object.entries(mounted || {})) {
    if (!m || impl === exceptImplement) continue;
    const mult = m.groupSize || 2; // cada entrada de side se repite groupSize veces
    for (const s of m.side || []) occ[s.kg] = (occ[s.kg] || 0) + s.n * mult;
  }
  return occ;
}

// Cargas posibles para un ejercicio dado el inventario, los ajustes y lo montado.
function loadsFor(exercise, inventory, settings, mounted) {
  const mode = exercise.loadMode;
  const implement = LOAD_MODES[mode].implement;
  if (mode === "kettlebell") {
    return inventory.kettlebells.map((k) => ({ kg: k.kg, side: [], nPlates: 0, label: `KB ${fmtKg(k.kg)}` }));
  }
  if (mode === "bodyweight") {
    // Lastre: sin peso, una kettlebell, uno o dos discos sueltos (no hace falta simetría).
    const free = freePlates(inventory, occupiedBy(mounted, null));
    const set = new Map([[0, { kg: 0, side: [], nPlates: 0, label: "sin lastre" }]]);
    inventory.kettlebells.forEach((k) => set.set(k.kg, { kg: k.kg, side: [], nPlates: 0, label: `KB ${fmtKg(k.kg)}` }));
    const singles = free.flatMap((p) => Array(Math.min(p.count, 2)).fill(p.kg));
    for (let i = 0; i < singles.length; i++) {
      const a = singles[i];
      if (!set.has(a)) set.set(a, { kg: a, side: [{ kg: a, n: 1 }], nPlates: 1, label: `disco ${fmtKg(a)}` });
      for (let j = i + 1; j < singles.length; j++) {
        const t = r1(a + singles[j]);
        if (!set.has(t)) set.set(t, { kg: t, side: [{ kg: a, n: 1 }, { kg: singles[j], n: 1 }], nPlates: 2, label: `${fmtKg(a)} + ${fmtKg(singles[j])}` });
      }
    }
    return [...set.values()].sort((a, b) => a.kg - b.kg);
  }
  const free = freePlates(inventory, occupiedBy(mounted, implement));
  const barKg = mode === "barbell" ? settings.barbellKg : settings.dumbbellBarKg;
  const groupSize = mode === "pair" ? 4 : 2;
  return enumerateLoads(free, barKg, groupSize).map((l) => ({
    ...l, groupSize,
    label: l.side.length ? l.side.map((s) => (s.n > 1 ? `${s.n}×${fmtKg(s.kg)}` : fmtKg(s.kg))).join(" + ") + " / lado" : "solo barra",
  }));
}

// Valida un peso escrito a mano contra la lista de cargas posibles.
function validateLoad(kg, loads) {
  const exact = loads.find((l) => Math.abs(l.kg - kg) < 0.01);
  if (exact) return { ok: true, load: exact };
  const below = [...loads].reverse().find((l) => l.kg < kg);
  const above = loads.find((l) => l.kg > kg);
  return { ok: false, below, above };
}

// Incremento mínimo real que permiten los discos (1,5 kg por lado → 3 kg).
const MIN_STEP_KG = 3;

/* =============================================================================
 * MÉTRICAS DERIVADAS
 * ========================================================================== */
const epley = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);

function doneSets(sessionEx) { return (sessionEx.sets || []).filter((s) => s.done && num(s.reps) > 0); }

// Mejor marca histórica de un ejercicio: mayor 1RM estimado (o más reps si no hay carga).
function bestFor(sessions, exerciseId, { excludeSessionId, beforeISO } = {}) {
  let best = null;
  for (const ss of sessions) {
    if (!ss.finishedAt || ss.id === excludeSessionId) continue;
    if (beforeISO && ss.date > beforeISO) continue;
    for (const ex of ss.exercises) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const s of doneSets(ex)) {
        const kg = num(s.kg), reps = num(s.reps);
        const e1 = epley(kg, reps);
        const score = kg > 0 ? e1 : reps;
        if (!best || score > best.score) best = { score, e1rm: e1, kg, reps, date: ss.date };
      }
    }
  }
  return best;
}

function lastSessionFor(sessions, exerciseId, excludeSessionId) {
  const list = sessions
    .filter((ss) => ss.finishedAt && ss.id !== excludeSessionId && ss.exercises.some((e) => e.exerciseId === exerciseId && doneSets(e).length))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) return null;
  const ss = list[0];
  return { date: ss.date, ex: ss.exercises.find((e) => e.exerciseId === exerciseId) };
}

// Serie de 1RM estimado por sesión (máximo de la sesión).
function e1rmHistory(sessions, exerciseId) {
  return sessions
    .filter((ss) => ss.finishedAt)
    .map((ss) => {
      const ex = ss.exercises.find((e) => e.exerciseId === exerciseId);
      if (!ex) return null;
      const vals = doneSets(ex).map((s) => epley(num(s.kg), num(s.reps)));
      const topKg = Math.max(0, ...doneSets(ex).map((s) => num(s.kg)));
      return vals.length ? { date: ss.date, e1rm: r1(Math.max(...vals)), kg: topKg } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function sessionTonnage(session, exercisesById) {
  return sum(session.exercises.map((ex) => {
    const mult = LOAD_MODES[exercisesById[ex.exerciseId]?.loadMode || "barbell"].tonnageX;
    return sum(doneSets(ex).map((s) => num(s.kg) * mult * num(s.reps)));
  }));
}
function sessionSetCount(session) { return sum(session.exercises.map((ex) => doneSets(ex).length)); }

// Series efectivas por grupo muscular (RIR ≤ 4; secundarios cuentan 0,5).
function volumeByMuscle(sessions, exercisesById, fromISO, toISO) {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const ss of sessions) {
    if (!ss.finishedAt || ss.date < fromISO || ss.date > toISO) continue;
    for (const ex of ss.exercises) {
      const def = exercisesById[ex.exerciseId];
      if (!def) continue;
      const eff = doneSets(ex).filter((s) => s.rir == null || s.rir === "" || num(s.rir) <= 4).length;
      out[def.muscle] += eff;
      for (const m of def.secondary || []) if (out[m] != null) out[m] += eff * 0.5;
    }
  }
  return out;
}

function movingAverage(series, window = 7) {
  // series: [{date, kg}] ordenada; media de los registros dentro de los últimos `window` días.
  return series.map((p, i) => {
    const from = addDays(p.date, -(window - 1));
    const win = series.slice(0, i + 1).filter((q) => q.date >= from);
    return { ...p, ma: r1(sum(win.map((q) => q.kg)) / win.length) };
  });
}

// Sugerencia de progresión (doble progresión + incrementos reales de discos).
function suggestProgression({ exercise, block, last, loads }) {
  if (!last) return { type: "start", text: "Primera vez: elige una carga que te deje 2-3 RIR en el rango de reps." };
  const sets = doneSets(last.ex);
  if (!sets.length) return null;
  const kg = Math.max(...sets.map((s) => num(s.kg)));
  const minReps = Math.min(...sets.map((s) => num(s.reps)));
  const minRir = Math.min(...sets.map((s) => (s.rir == null || s.rir === "" ? 2 : num(s.rir))));
  const repsMax = block?.repsMax ?? 12;
  const isBW = exercise.loadMode === "bodyweight";
  const hitTop = minReps >= repsMax && minRir >= 1;

  if (!hitTop) {
    return { type: "reps", kg, text: `Mantén ${isBW && kg === 0 ? "el peso corporal" : fmtKg(kg) + " kg"} y busca ${Math.min(repsMax, minReps + 1)}+ reps en todas las series.` };
  }
  if (exercise.lower && kg >= 60 && exercise.loadMode === "barbell") {
    return { type: "mech", kg, text: `Carga alta (${fmtKg(kg)} kg de ${fmtKg(loads[loads.length - 1]?.kg ?? 86)} posibles). Progresa por dificultad: tempo 3-1-1, pausa 2 s abajo, variante unilateral o más rango, antes que subir kilos.` };
  }
  const next = loads.find((l) => l.kg > kg + 0.01);
  if (!next) {
    return { type: "sets", kg, text: `No hay carga mayor montable ahora. Añade una serie (${sets.length + 1}) o sube el tope de reps.` };
  }
  const step = r1(next.kg - kg);
  if (step <= MIN_STEP_KG + 0.01) {
    return { type: "load", kg: next.kg, text: `Todas las series al tope con RIR ≥ 1. Sube a ${fmtKg(next.kg)} kg (+${fmtKg(step)}).` };
  }
  return { type: "sets", kg, text: `El siguiente salto montable es ${fmtKg(kg)} → ${fmtKg(next.kg)} kg (+${fmtKg(step)}), demasiado grande. Antes añade una serie (${sets.length + 1}) o sube el rango a ${repsMax + 2} reps.` };
}

/* =============================================================================
 * INTEGRACIÓN CON HOME ASSISTANT
 * Todo pasa por este objeto. `ha.available` es la única comprobación: cuando
 * hass es nulo (fuera de HA) ninguna función hace nada y la app sigue en local.
 * ========================================================================== */
class HAError extends Error {
  constructor(message, entity) { super(message); this.entity = entity; }
}

const ha = {
  hass: null,
  narrow: false,
  _listeners: new Set(),
  _watched: [],
  _sig: "",
  _timer: null,
  get available() { return !!this.hass; },
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  watch(entityIds) { this._watched = entityIds.filter(Boolean); },
  setHass(hass) {
    const wasAvailable = !!this.hass;
    this.hass = hass;
    // hass llega en cada cambio de estado de toda la casa: solo se re-renderiza
    // si cambia algo que la app mira (entidades configuradas, número de entidades).
    const states = hass?.states || {};
    const sig = [Object.keys(states).length, ...this._watched.map((id) => `${id}=${states[id]?.state}`)].join("|");
    if (sig !== this._sig || wasAvailable !== !!hass) {
      this._sig = sig;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._listeners.forEach((fn) => fn()), 150);
    }
  },
  entities(domain) {
    if (!this.hass) return [];
    return Object.values(this.hass.states)
      .filter((s) => s.entity_id.startsWith(domain + "."))
      .map((s) => ({ id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state, attributes: s.attributes }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  services(domain) {
    if (!this.hass?.services?.[domain]) return [];
    return Object.keys(this.hass.services[domain]).map((s) => `${domain}.${s}`).sort();
  },
  state(entityId) { return entityId && this.hass ? this.hass.states[entityId] : undefined; },
  // Llamada a servicio con control de errores. Lanza HAError con la entidad implicada.
  async callService(domain, service, data, entity) {
    if (!this.hass) throw new HAError("Home Assistant no está disponible", entity);
    if (entity && !this.hass.states[entity]) throw new HAError(`La entidad ${entity} no existe en Home Assistant`, entity);
    try {
      await this.hass.callService(domain, service, data);
    } catch (e) {
      throw new HAError(`${domain}.${service} falló${entity ? ` en ${entity}` : ""}: ${e?.message || e?.error?.message || "error desconocido"}`, entity);
    }
  },
  // Histórico de una entidad. Ruta principal: WebSocket history/history_during_period.
  // Ruta alternativa: REST GET history/period/<inicio>?filter_entity_id=...
  async history(entityId, start, end) {
    if (!this.hass || !entityId) return [];
    const startISO = start.toISOString(), endISO = end.toISOString();
    try {
      // Respuesta comprimida: { [entity_id]: [{ s: estado, lu: last_updated (s), a?: atributos }] }
      const res = await this.hass.callWS({
        type: "history/history_during_period",
        start_time: startISO, end_time: endISO, entity_ids: [entityId],
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const rows = res?.[entityId] || [];
      return rows.map((r) => ({ state: r.s, ts: new Date(r.lu * 1000) }));
    } catch (e) {
      // Alternativa para versiones sin ese mensaje WS. Respuesta: [[{state, last_changed}]]
      const res = await this.hass.callApi("GET", `history/period/${encodeURIComponent(startISO)}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(endISO)}&minimal_response&no_attributes`);
      const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : [];
      return rows.map((r) => ({ state: r.state, ts: new Date(r.last_changed || r.last_updated) }));
    }
  },
};

// Serie de peso de la báscula de HA agrupada por día (última lectura del día).
function scaleSeriesByDay(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const kg = parseFloat(r.state);
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) continue;
    byDay.set(isoOf(r.ts), r1(kg));
  }
  return [...byDay.entries()].map(([date, kg]) => ({ date, kg, source: "ha" })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Avisos sonoros y hápticos del temporizador (sin dependencias).
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18, 0.36].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* sin audio */ }
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* sin vibración */ }
}

/* =============================================================================
 * ESTADO GLOBAL · almacén en memoria con escritura directa a `db`
 * ========================================================================== */
const StoreCtx = createContext(null);
const ToastCtx = createContext(() => {});
const useStore = () => useContext(StoreCtx);
const useToast = () => useContext(ToastCtx);

function buildSeed() {
  return {
    settings: [DEFAULT_SETTINGS], inventory: [DEFAULT_INVENTORY], exercises: SEED_EXERCISES,
    routines: SEED_ROUTINES, sessions: seedSessions(), foods: SEED_FOODS, recipes: SEED_RECIPES,
    diary: seedDiary(), bodyweight: seedBodyweight(), haQueue: [],
  };
}
function normalize(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings?.[0] || {}) };
  settings.ha = { ...DEFAULT_SETTINGS.ha, ...(settings.ha || {}), helpers: { ...DEFAULT_SETTINGS.ha.helpers, ...(settings.ha?.helpers || {}) } };
  settings.goals = { ...DEFAULT_SETTINGS.goals, ...(settings.goals || {}) };
  settings.profile = { ...DEFAULT_SETTINGS.profile, ...(settings.profile || {}) };
  const inventory = { ...DEFAULT_INVENTORY, ...(raw.inventory?.[0] || {}) };
  return {
    settings, inventory,
    exercises: raw.exercises || [], routines: raw.routines || [], sessions: raw.sessions || [],
    foods: raw.foods || [], recipes: raw.recipes || [], diary: raw.diary || [],
    bodyweight: raw.bodyweight || [], haQueue: raw.haQueue || [],
  };
}

function StoreProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let raw = await db.loadAll();
        if (!raw.settings?.length) {
          raw = buildSeed();
          for (const [s, recs] of Object.entries(raw)) await db.putMany(s, recs);
        }
        setData(normalize(raw));
      } catch (e) { setError(e); }
    })();
  }, []);

  const api = useMemo(() => {
    if (!data) return null;
    const upsert = (arr, rec, key) => {
      const i = arr.findIndex((r) => r[key] === rec[key]);
      return i >= 0 ? arr.map((r, j) => (j === i ? rec : r)) : [...arr, rec];
    };
    const persist = (p) => p.catch((e) => console.error("[entreno] error al guardar", e));
    return {
      data,
      put(store, rec) {
        setData((d) => ({ ...d, [store]: upsert(d[store], rec, STORES[store]) }));
        persist(db.put(store, rec));
      },
      remove(store, key) {
        setData((d) => ({ ...d, [store]: d[store].filter((r) => r[STORES[store]] !== key) }));
        persist(db.del(store, key));
      },
      setSettings(patch) {
        const next = typeof patch === "function" ? patch(data.settings) : { ...data.settings, ...patch };
        setData((d) => ({ ...d, settings: next }));
        persist(db.put("settings", next));
      },
      setInventory(next) {
        setData((d) => ({ ...d, inventory: next }));
        persist(db.put("inventory", next));
      },
      async replaceAll(raw) {
        const n = normalize(raw);
        for (const s of Object.keys(STORES)) await db.clear(s);
        await db.putMany("settings", [n.settings]);
        await db.putMany("inventory", [n.inventory]);
        for (const s of ["exercises", "routines", "sessions", "foods", "recipes", "diary", "bodyweight", "haQueue"]) await db.putMany(s, n[s]);
        setData(n);
      },
      exportJSON: () => db.exportAll(),
    };
  }, [data]);

  if (error) return <div className="e-page"><div className="e-note err"><AlertTriangle /> No se pudo abrir el almacén local: {String(error.message || error)}</div></div>;
  if (!api) return <div className="e-page"><p className="e-muted">Cargando…</p></div>;
  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, kind = "info", ms = 4200) => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const Icon = { info: Info, err: AlertTriangle, ok: CircleCheck, warn: AlertTriangle };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="e-toasts" aria-live="polite">
        {toasts.map((t) => { const I = Icon[t.kind] || Info; return <div key={t.id} className={`e-toast ${t.kind}`}><I /><span>{t.text}</span></div>; })}
      </div>
    </ToastCtx.Provider>
  );
}

// Re-render cuando cambia algo relevante de hass.
function useHA(watchIds) {
  const [, setTick] = useState(0);
  useEffect(() => ha.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { ha.watch(watchIds || []); }, [JSON.stringify(watchIds || [])]);
  return ha;
}

/* =============================================================================
 * CAPA DE PUBLICACIÓN HACIA HA · con cola de reintentos persistente
 * ========================================================================== */
function useIntegration() {
  const store = useStore();
  const toast = useToast();
  const { settings, haQueue } = store.data;
  const cfg = settings.ha;
  const active = cfg.enabled && ha.available;

  const enqueue = useCallback((job, err) => {
    store.put("haQueue", { id: uid(), ...job, createdAt: new Date().toISOString(), attempts: 1, lastError: err.message });
  }, [store]);

  // Envía o encola. Nunca lanza: la app sigue en local.
  const send = useCallback(async (job) => {
    if (!cfg.enabled) return false;
    try {
      await ha.callService(job.domain, job.service, job.data, job.entity);
      return true;
    } catch (e) {
      toast(`${job.label}: ${e.message}. Se reintentará.`, "err", 6000);
      enqueue(job, e);
      return false;
    }
  }, [cfg.enabled, toast, enqueue]);

  const flushQueue = useCallback(async () => {
    if (!ha.available || !haQueue.length) return { ok: 0, fail: 0 };
    let ok = 0, fail = 0;
    for (const job of haQueue) {
      try {
        await ha.callService(job.domain, job.service, job.data, job.entity);
        store.remove("haQueue", job.id); ok++;
      } catch (e) {
        store.put("haQueue", { ...job, attempts: (job.attempts || 0) + 1, lastError: e.message }); fail++;
      }
    }
    if (ok) toast(`${ok} envío${ok > 1 ? "s" : ""} pendiente${ok > 1 ? "s" : ""} entregado${ok > 1 ? "s" : ""} a Home Assistant`, "ok");
    return { ok, fail };
  }, [haQueue, store, toast]);

  // Reintento automático: al conectar y cada 60 s mientras haya cola.
  const flushRef = useRef(flushQueue); flushRef.current = flushQueue;
  useEffect(() => {
    if (!active || !haQueue.length) return;
    const t = setTimeout(() => flushRef.current(), 2000);
    const i = setInterval(() => flushRef.current(), 60000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [active, haQueue.length]);

  const setNumber = (entity, value, label) => entity && send({ domain: "input_number", service: "set_value", data: { entity_id: entity, value: r1(value) }, entity, label });

  return {
    active,
    send, flushQueue,
    async onSessionStart() { if (cfg.sceneStart) await send({ domain: "scene", service: "turn_on", data: { entity_id: cfg.sceneStart }, entity: cfg.sceneStart, label: "Escena de inicio" }); },
    async onSessionClose(session, metrics) {
      const h = cfg.helpers;
      await setNumber(h.weeklyVolume, metrics.weeklyVolume, "Volumen semanal");
      await setNumber(h.weeklySessions, metrics.weeklySessions, "Sesiones de la semana");
      await setNumber(h.adherence, metrics.adherence, "Adherencia");
      await setNumber(h.dayTonnage, metrics.dayTonnage, "Tonelaje del día");
      if (cfg.calendarEntity) {
        const start = new Date(session.startedAt), end = new Date(session.finishedAt);
        await send({
          domain: "calendar", service: "create_event", entity: cfg.calendarEntity, label: "Evento de calendario",
          data: {
            entity_id: cfg.calendarEntity,
            summary: `Entreno · ${session.dayName || "Sesión"}`,
            description: metrics.summaryText,
            start_date_time: start.toISOString(), end_date_time: end.toISOString(),
          },
        });
      }
      if (cfg.sceneEnd) await send({ domain: "scene", service: "turn_on", data: { entity_id: cfg.sceneEnd }, entity: cfg.sceneEnd, label: "Escena de cierre" });
    },
    async publishProteinLeft(grams) { await setNumber(cfg.helpers.proteinLeft, Math.max(0, grams), "Proteína restante"); },
    async sendShoppingList(items) {
      if (!cfg.todoEntity) { toast("Configura la lista de tareas en Ajustes → Home Assistant", "warn"); return; }
      let n = 0;
      for (const item of items) { if (await send({ domain: "todo", service: "add_item", data: { entity_id: cfg.todoEntity, item }, entity: cfg.todoEntity, label: "Lista de la compra" })) n++; }
      if (n) toast(`${n} ingrediente${n > 1 ? "s" : ""} añadido${n > 1 ? "s" : ""} a la lista`, "ok");
    },
    async notifyRestDone(text) {
      if (!cfg.notifyOnRest) return;
      if (cfg.notifyService) {
        const [d, s] = cfg.notifyService.split(".");
        await send({ domain: d, service: s, data: { message: text, title: "Entreno" }, label: "Notificación de descanso" });
      }
      if (cfg.ttsService) {
        const [d, s] = cfg.ttsService.split(".");
        const data = s === "speak"
          ? { entity_id: cfg.ttsEntity, media_player_entity_id: cfg.mediaPlayerEntity, message: text }
          : { entity_id: cfg.mediaPlayerEntity, message: text };
        await send({ domain: d, service: s, data, entity: s === "speak" ? cfg.ttsEntity : cfg.mediaPlayerEntity, label: "Aviso por voz" });
      }
    },
  };
}

// Serie de peso de la báscula configurada (histórico de 120 días + estado actual).
function useScaleSeries() {
  const { data } = useStore();
  const toast = useToast();
  const cfg = data.settings.ha;
  const entity = cfg.enabled ? cfg.scaleEntity : "";
  const haRef = useHA([entity]);
  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState("idle");
  const current = haRef.state(entity)?.state;
  useEffect(() => {
    if (!entity || !haRef.available) { setSeries([]); setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    const end = new Date(), start = new Date(Date.now() - 120 * 86400e3);
    haRef.history(entity, start, end).then((rows) => {
      if (cancelled) return;
      const s = scaleSeriesByDay(rows);
      const st = haRef.state(entity);
      const kg = parseFloat(st?.state);
      if (Number.isFinite(kg)) {
        const d = isoOf(new Date(st.last_updated || Date.now()));
        const i = s.findIndex((p) => p.date === d);
        if (i >= 0) s[i] = { ...s[i], kg: r1(kg) }; else s.push({ date: d, kg: r1(kg), source: "ha" });
      }
      setSeries(s.sort((a, b) => (a.date < b.date ? -1 : 1)));
      setStatus("ok");
    }).catch((e) => {
      if (cancelled) return;
      setStatus("error");
      toast(`No se pudo leer el histórico de ${entity}: ${e?.message || e}`, "err");
    });
    return () => { cancelled = true; };
  }, [entity, current, haRef.available]);
  return { series, status, entity };
}

// Serie combinada de peso: báscula de HA como fuente, manual como respaldo.
function useWeightSeries() {
  const { data } = useStore();
  const scale = useScaleSeries();
  const merged = useMemo(() => {
    const map = new Map();
    for (const p of data.bodyweight) map.set(p.date, { date: p.date, kg: p.kg, source: "manual" });
    for (const p of scale.series) map.set(p.date, p); // HA manda en los días con lectura
    return movingAverage([...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1)));
  }, [data.bodyweight, scale.series]);
  return { series: merged, scale };
}

/* =============================================================================
 * PRIMITIVAS DE INTERFAZ
 * ========================================================================== */
const Card = ({ title, big, action, children, className = "", flush, accent }) => (
  <section className={`e-card ${flush ? "flush" : ""} ${accent ? "accent" : ""} ${className}`}>
    {(title || action) && (
      <div className="e-card-head" style={flush ? { padding: "16px 16px 0" } : undefined}>
        {title && <h2 className={`e-card-title ${big ? "big" : ""}`}>{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);
const Btn = ({ variant = "ghost", size = "", full, icon: I, children, className = "", ...rest }) => (
  <button type="button" className={`e-btn ${variant} ${size} ${full ? "full" : ""} ${className}`} {...rest}>{I && <I />}{children}</button>
);
const IconBtn = ({ icon: I, label, small, on, ...rest }) => (
  <button type="button" className={`e-icon-btn ${small ? "sm" : ""} ${on ? "on" : ""}`} aria-label={label} title={label} {...rest}><I /></button>
);
const Chip = ({ kind = "", icon: I, children, ...rest }) => <span className={`e-chip ${kind}`} {...rest}>{I && <I />}{children}</span>;
const Field = ({ label, children, hint }) => (
  <div className="e-field">{label && <label>{label}</label>}{children}{hint && <span className="e-muted">{hint}</span>}</div>
);
const Input = ({ className = "", ...rest }) => <input className={`e-input ${className}`} {...rest} />;
const Select = ({ options, placeholder, className = "", value, ...rest }) => (
  <select className={`e-select ${className}`} value={value ?? ""} {...rest}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
  </select>
);
const Toggle = ({ label, hint, on, onChange, id }) => (
  <button type="button" id={id} role="switch" aria-checked={!!on} className={`e-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
    <span className="e-stack" style={{ textAlign: "left" }}><span style={{ fontWeight: 500 }}>{label}</span>{hint && <span className="e-muted">{hint}</span>}</span>
    <span className="track" />
  </button>
);
const Segmented = ({ options, value, onChange }) => (
  <div className="e-seg" role="tablist">
    {options.map((o) => <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
);
function Sheet({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="e-sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="e-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="e-sheet-head"><h2>{title}</h2><IconBtn icon={X} label="Cerrar" small onClick={onClose} /></div>
        <div className="e-sheet-body">{children}</div>
        {footer && <div style={{ padding: "8px 16px 16px" }}>{footer}</div>}
      </div>
    </div>
  );
}
const Ring = ({ value, max, size = 96, stroke = 9, color = "var(--e-acc)", children }) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = max > 0 ? clamp(value / max, 0, 1) : 0;
  const over = max > 0 && value > max;
  return (
    <div className="e-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--e-card2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? "var(--e-err)" : color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .4s" }} />
      </svg>
      <div className="c">{children}</div>
    </div>
  );
};
const MacroBar = ({ label, value, max, unit = "g" }) => (
  <div className="e-macro">
    <div className="top"><span className="e-muted">{label}</span><span><b>{fmtN(value)}</b><span className="e-muted"> / {fmtN(max)} {unit}</span></span></div>
    <div className="e-bar"><i className={value > max ? "over" : ""} style={{ width: `${clamp((value / (max || 1)) * 100, 0, 100)}%` }} /></div>
  </div>
);
const Note = ({ kind = "", icon: I = Info, children }) => <div className={`e-note ${kind}`}><I />{children}</div>;
const Empty = ({ icon: I = Info, children }) => <div className="e-empty"><I />{children}</div>;
const ChartTip = ({ active, payload, label, fmt }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="e-tooltip">
      <div className="e-muted">{label}</div>
      {payload.map((p) => <div key={p.dataKey}><span style={{ color: p.color }}>●</span> {p.name}: <b>{fmt ? fmt(p.value, p.dataKey) : p.value}</b></div>)}
    </div>
  );
};
const CHART_AXIS = { tick: { fill: "var(--e-text2)", fontSize: 11 }, axisLine: false, tickLine: false };

/* =============================================================================
 * NAVEGACIÓN
 * ========================================================================== */
const NavCtx = createContext(null);
const useNav = () => useContext(NavCtx);

/* =============================================================================
 * MÓDULO DE ENTRENAMIENTO
 * ========================================================================== */
function useExercisesById() {
  const { data } = useStore();
  return useMemo(() => Object.fromEntries(data.exercises.map((e) => [e.id, e])), [data.exercises]);
}
const useActiveSession = () => { const { data } = useStore(); return data.sessions.find((s) => !s.finishedAt) || null; };

// Día previsto de la rutina activa: el siguiente al último entrenado.
function plannedDay(data) {
  const routine = data.routines.find((r) => r.id === data.settings.activeRoutineId) || data.routines[0];
  if (!routine || !routine.days.length) return null;
  const last = data.sessions.filter((s) => s.finishedAt && s.routineId === routine.id).sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1))[0];
  const idx = last ? (last.dayIndex + 1) % routine.days.length : 0;
  return { routine, dayIndex: idx, day: routine.days[idx] };
}

function buildSession(routine, dayIndex, data) {
  const day = routine.days[dayIndex];
  return {
    id: uid(), date: todayISO(), routineId: routine.id, dayIndex, dayName: day.name,
    startedAt: new Date().toISOString(), finishedAt: null, note: "",
    mounted: { barbell: null, dumbbells: null },
    exercises: day.blocks.map((b) => {
      const last = lastSessionFor(data.sessions, b.exerciseId);
      const lastSets = last ? doneSets(last.ex) : [];
      return {
        exerciseId: b.exerciseId, restSec: b.restSec, repsMin: b.repsMin, repsMax: b.repsMax,
        sets: Array.from({ length: b.sets }, (_, i) => ({ kg: lastSets[i]?.kg ?? lastSets[lastSets.length - 1]?.kg ?? null, reps: "", rir: "", done: false, pr: false })),
      };
    }),
  };
}

function ExercisePicker({ open, onClose, onPick, exclude = [] }) {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const [m, setM] = useState("");
  const list = data.exercises.filter((e) => !exclude.includes(e.id) && (!m || e.muscle === m) && (!q || e.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <Sheet open={open} onClose={onClose} title="Añadir ejercicio">
      <Input id="picker-q" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="e-chips scroll">
        <button className={`e-chip ${!m ? "on" : ""}`} onClick={() => setM("")}>Todos</button>
        {MUSCLES.map((x) => <button key={x} className={`e-chip ${m === x ? "on" : ""}`} onClick={() => setM(x)}>{x}</button>)}
      </div>
      <div className="e-list">
        {list.map((e) => (
          <button key={e.id} className="e-item" onClick={() => { onPick(e); onClose(); }}>
            <span className="e-grow e-stack"><span className="t">{e.name}</span><span className="s">{e.muscle} · {EQUIPMENT_LABEL[e.loadMode]}</span></span>
            <Plus style={{ width: 18, color: "var(--e-text2)" }} />
          </button>
        ))}
        {!list.length && <Empty icon={Search}>Sin resultados</Empty>}
      </div>
    </Sheet>
  );
}

function RoutinesView() {
  const store = useStore();
  const { data } = store;
  const nav = useNav();
  const toast = useToast();
  const exById = useExercisesById();
  const active = useActiveSession();
  const integration = useIntegration();
  const planned = plannedDay(data);
  const [open, setOpen] = useState(null); // rutina abierta
  const [editing, setEditing] = useState(null);

  const start = (routine, dayIndex) => {
    if (active) { toast("Ya hay una sesión en curso", "warn"); nav.go("entreno", "session"); return; }
    const ss = buildSession(routine, dayIndex, data);
    store.put("sessions", ss);
    integration.onSessionStart();
    nav.go("entreno", "session");
  };
  const duplicate = (r) => { const c = { ...r, id: uid(), name: `${r.name} (copia)`, days: r.days.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) })) }; store.put("routines", c); toast("Rutina duplicada", "ok"); };
  const remove = (r) => {
    if (!window.confirm(`¿Eliminar la rutina «${r.name}»?`)) return;
    store.remove("routines", r.id);
    if (data.settings.activeRoutineId === r.id) store.setSettings({ activeRoutineId: data.routines.find((x) => x.id !== r.id)?.id || "" });
    setOpen(null);
  };

  if (editing) return <RoutineEditor routine={editing} onClose={() => { setEditing(null); }} />;
  if (open) {
    const r = data.routines.find((x) => x.id === open.id) || open;
    const isActive = data.settings.activeRoutineId === r.id;
    return (
      <div className="e-page">
        <div className="e-header">
          <div className="e-row"><IconBtn icon={ChevronLeft} label="Volver" onClick={() => setOpen(null)} /><div><h1>{r.name}</h1><div className="sub">{r.days.length} días · {isActive ? "rutina activa" : "plantilla"}</div></div></div>
          <div className="e-header-actions"><IconBtn icon={Pencil} label="Editar" onClick={() => setEditing(r)} /><IconBtn icon={Copy} label="Duplicar" onClick={() => duplicate(r)} /><IconBtn icon={Trash2} label="Eliminar" onClick={() => remove(r)} /></div>
        </div>
        {r.description && <p className="e-muted">{r.description}</p>}
        {!isActive && <Btn variant="soft" icon={Check} onClick={() => { store.setSettings({ activeRoutineId: r.id }); toast("Rutina activada", "ok"); }}>Usar como rutina activa</Btn>}
        {r.days.map((d, i) => (
          <Card key={i} flush>
            <div className="e-card-head" style={{ padding: "16px 16px 8px" }}>
              <h2 className="e-card-title big">{d.name}</h2>
              <Btn variant={isActive && planned?.dayIndex === i ? "primary" : "soft"} size="sm" icon={Play} onClick={() => start(r, i)}>{isActive && planned?.dayIndex === i ? "Empezar · previsto" : "Empezar"}</Btn>
            </div>
            <div className="e-list">
              {d.blocks.map((b, j) => {
                const e = exById[b.exerciseId];
                return (
                  <div key={j} className="e-item" style={{ minHeight: 48 }}>
                    <span className="e-grow e-stack"><span className="t">{e?.name || b.exerciseId}</span><span className="s">{e?.muscle} · {EQUIPMENT_LABEL[e?.loadMode] || ""}</span></span>
                    <span className="v">{b.sets} × {b.repsMin}–{b.repsMax}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="e-page">
      {active && (
        <Card accent>
          <div className="e-row between"><div className="e-stack"><span className="e-label">Sesión en curso</span><b style={{ fontSize: 17 }}>{active.dayName}</b></div><Btn variant="primary" icon={Play} onClick={() => nav.go("entreno", "session")}>Continuar</Btn></div>
        </Card>
      )}
      {planned && !active && (
        <Card title="Próxima sesión">
          <div className="e-row between">
            <div className="e-stack"><b style={{ fontSize: 22, fontWeight: 600 }}>{planned.day.name}</b><span className="e-muted">{planned.routine.name} · {planned.day.blocks.length} ejercicios</span></div>
            <Btn variant="primary" icon={Play} onClick={() => start(planned.routine, planned.dayIndex)}>Empezar</Btn>
          </div>
        </Card>
      )}
      <Card title="Rutinas" flush action={<Btn size="sm" variant="soft" icon={Plus} onClick={() => setEditing({ id: uid(), name: "Nueva rutina", description: "", days: [{ name: "Día 1", blocks: [] }] })}>Nueva</Btn>}>
        <div className="e-list" style={{ marginTop: 8 }}>
          {data.routines.map((r) => (
            <button key={r.id} className="e-item" onClick={() => setOpen(r)}>
              <span className="e-grow e-stack"><span className="t">{r.name}</span><span className="s">{r.days.map((d) => d.name).join(" · ")}</span></span>
              {data.settings.activeRoutineId === r.id && <Chip kind="acc">activa</Chip>}
              <ChevronRight style={{ width: 18, color: "var(--e-text2)" }} />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RoutineEditor({ routine, onClose }) {
  const store = useStore();
  const toast = useToast();
  const exById = useExercisesById();
  const [r, setR] = useState(() => JSON.parse(JSON.stringify(routine)));
  const [picker, setPicker] = useState(null); // índice de día
  const upDay = (i, patch) => setR((x) => ({ ...x, days: x.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const upBlock = (i, j, patch) => upDay(i, { blocks: r.days[i].blocks.map((b, k) => (k === j ? { ...b, ...patch } : b)) });
  const move = (i, j, dir) => { const bl = [...r.days[i].blocks]; const k = j + dir; if (k < 0 || k >= bl.length) return; [bl[j], bl[k]] = [bl[k], bl[j]]; upDay(i, { blocks: bl }); };
  const save = () => {
    if (!r.name.trim()) { toast("Ponle nombre a la rutina", "warn"); return; }
    const clean = { ...r, days: r.days.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b, sets: clamp(num(b.sets, 3), 1, 12), repsMin: clamp(num(b.repsMin, 8), 1, 100), repsMax: clamp(Math.max(num(b.repsMax, 12), num(b.repsMin, 8)), 1, 100), restSec: clamp(num(b.restSec, 90), 15, 600) })) })) };
    store.put("routines", clean);
    if (!store.data.settings.activeRoutineId) store.setSettings({ activeRoutineId: clean.id });
    toast("Rutina guardada", "ok");
    onClose();
  };
  return (
    <div className="e-page">
      <div className="e-header">
        <div className="e-row"><IconBtn icon={X} label="Cancelar" onClick={onClose} /><h1>Editar rutina</h1></div>
        <Btn variant="primary" size="sm" icon={Check} onClick={save}>Guardar</Btn>
      </div>
      <Card>
        <Field label="Nombre"><Input id="rt-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
        <Field label="Descripción"><Input id="rt-desc" value={r.description || ""} onChange={(e) => setR({ ...r, description: e.target.value })} /></Field>
      </Card>
      {r.days.map((d, i) => (
        <Card key={i}>
          <div className="e-row">
            <Input id={`rt-day-${i}`} value={d.name} onChange={(e) => upDay(i, { name: e.target.value })} style={{ fontWeight: 600 }} />
            <IconBtn icon={Trash2} label="Eliminar día" onClick={() => setR({ ...r, days: r.days.filter((_, j) => j !== i) })} />
          </div>
          {d.blocks.map((b, j) => (
            <div key={j} className="e-col" style={{ padding: 12, borderRadius: 12, background: "var(--e-card2)" }}>
              <div className="e-row between">
                <b className="e-ellip">{exById[b.exerciseId]?.name || b.exerciseId}</b>
                <div className="e-row" style={{ gap: 0 }}>
                  <IconBtn small icon={ArrowUp} label="Subir" onClick={() => move(i, j, -1)} />
                  <IconBtn small icon={ArrowDown} label="Bajar" onClick={() => move(i, j, 1)} />
                  <IconBtn small icon={Trash2} label="Quitar" onClick={() => upDay(i, { blocks: d.blocks.filter((_, k) => k !== j) })} />
                </div>
              </div>
              <div className="e-fields" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <Field label="Series"><Input type="number" inputMode="numeric" value={b.sets} onChange={(e) => upBlock(i, j, { sets: e.target.value })} /></Field>
                <Field label="Reps mín"><Input type="number" inputMode="numeric" value={b.repsMin} onChange={(e) => upBlock(i, j, { repsMin: e.target.value })} /></Field>
                <Field label="Reps máx"><Input type="number" inputMode="numeric" value={b.repsMax} onChange={(e) => upBlock(i, j, { repsMax: e.target.value })} /></Field>
                <Field label="Desc. s"><Input type="number" inputMode="numeric" value={b.restSec} onChange={(e) => upBlock(i, j, { restSec: e.target.value })} /></Field>
              </div>
            </div>
          ))}
          <Btn variant="outline" icon={Plus} onClick={() => setPicker(i)}>Añadir ejercicio</Btn>
        </Card>
      ))}
      <Btn variant="soft" icon={Plus} onClick={() => setR({ ...r, days: [...r.days, { name: `Día ${r.days.length + 1}`, blocks: [] }] })}>Añadir día</Btn>
      <ExercisePicker open={picker != null} onClose={() => setPicker(null)} exclude={picker != null ? r.days[picker].blocks.map((b) => b.exerciseId) : []}
        onPick={(e) => upDay(picker, { blocks: [...r.days[picker].blocks, { exerciseId: e.id, sets: 3, repsMin: 8, repsMax: 12, restSec: e.restSec || 90 }] })} />
    </div>
  );
}

/* ---------- Selector de carga ---------- */
function LoadSheet({ open, onClose, exercise, session, currentKg, onPick, onUnmount }) {
  const { data } = useStore();
  const [manual, setManual] = useState("");
  useEffect(() => { if (open) setManual(""); }, [open]);
  if (!exercise) return null;
  const mode = LOAD_MODES[exercise.loadMode];
  const loads = loadsFor(exercise, data.inventory, data.settings, session.mounted);
  const other = mode.implement === "barbell" ? session.mounted?.dumbbells : mode.implement === "dumbbells" ? session.mounted?.barbell : null;
  const otherName = mode.implement === "barbell" ? "las mancuernas" : "la barra";
  const own = mode.implement ? session.mounted?.[mode.implement] : null;
  const check = manual !== "" ? validateLoad(num(manual, NaN), loads) : null;
  const pick = (l) => { onPick(l); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title={`Carga · ${exercise.name}`}>
      <div className="e-row between wrap"><Chip kind="acc">{mode.unit}</Chip><span className="e-muted">{loads.length} carga{loads.length === 1 ? "" : "s"} montable{loads.length === 1 ? "" : "s"}</span></div>
      {other && (
        <Note kind="warn" icon={AlertTriangle}>
          <span>Hay {fmtKg(other.kg)} kg montados en {otherName} ({other.side.map((s) => `${s.n * (other.groupSize || 2)}×${fmtKg(s.kg)}`).join(", ")}). Esos discos no cuentan aquí.
            <button className="e-btn xs soft" style={{ marginLeft: 8 }} onClick={() => onUnmount(mode.implement === "barbell" ? "dumbbells" : "barbell")}>Descargar {otherName}</button></span>
        </Note>
      )}
      {own && <div className="e-row between"><span className="e-muted">Ahora montado en {mode.implement === "barbell" ? "la barra" : "las mancuernas"}: <b style={{ color: "var(--e-text)" }}>{fmtKg(own.kg)} kg</b></span><Btn size="xs" variant="outline" onClick={() => onUnmount(mode.implement)}>Descargar</Btn></div>}
      <div className="e-loads">
        {loads.map((l) => (
          <button key={l.kg} className={`e-load ${currentKg != null && Math.abs(l.kg - currentKg) < 0.01 ? "on" : ""}`} onClick={() => pick(l)}>
            <span className="kg">{fmtKg(l.kg)}</span><span className="pl">{l.label}</span>
          </button>
        ))}
        {!loads.length && <Empty icon={AlertTriangle}>Sin cargas posibles: todos los discos están en otro implemento.</Empty>}
      </div>
      {exercise.loadMode !== "kettlebell" && (
        <Field label="Escribir a mano" hint="Se comprueba contra tus discos disponibles.">
          <div className="e-row">
            <Input id="load-manual" type="number" inputMode="decimal" step="0.5" placeholder="kg" value={manual} onChange={(e) => setManual(e.target.value)} className={check && !check.ok ? "err" : ""} />
            <Btn variant="primary" disabled={!check?.ok} onClick={() => pick(check.load)}>Usar</Btn>
          </div>
          {check && !check.ok && (
            <Note kind="err" icon={AlertTriangle}>
              <span>{fmtKg(num(manual))} kg no se puede montar de forma simétrica con tus discos{other ? " libres" : ""}.
                {check.below && <> Lo más cercano: <button className="e-btn xs soft" onClick={() => pick(check.below)}>{fmtKg(check.below.kg)} kg</button></>}
                {check.above && <> <button className="e-btn xs soft" onClick={() => pick(check.above)}>{fmtKg(check.above.kg)} kg</button></>}</span>
            </Note>
          )}
        </Field>
      )}
    </Sheet>
  );
}

/* ---------- Temporizador de descanso ---------- */
function RestTimer({ timer, onChange, onDone }) {
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(false);
  const firedRef = useRef(false);
  useEffect(() => { firedRef.current = false; setHidden(false); }, [timer?.id]);
  useEffect(() => {
    if (!timer) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [timer]);
  useEffect(() => {
    if (!timer || firedRef.current) return;
    if (now >= timer.endAt) { firedRef.current = true; onDone(); }
  }, [now, timer, onDone]);
  if (!timer) return null;
  const left = Math.max(0, Math.ceil((timer.endAt - now) / 1000));
  const pct = clamp(left / timer.total, 0, 1);
  if (hidden) {
    return (
      <button className="e-card" style={{ position: "sticky", top: 8, zIndex: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", boxShadow: "0 8px 24px rgba(0,0,0,.35)" }} onClick={() => setHidden(false)}>
        <span className="e-row"><Timer style={{ width: 18, color: "var(--e-acc)" }} /><b style={{ fontSize: 20 }}>{fmtSecs(left)}</b><span className="e-muted">descanso</span></span>
        <span className="e-btn xs soft" onClick={(e) => { e.stopPropagation(); onChange(null); }}>Saltar</span>
      </button>
    );
  }
  const size = 240, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="e-timer" role="dialog" aria-label="Descanso">
      <span className="e-label">Descanso · {timer.exerciseName}</span>
      <div className="ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--e-card2)" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={left === 0 ? "var(--e-ok)" : "var(--e-acc)"} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .25s linear" }} />
        </svg>
        <div className="t">{fmtSecs(left)}</div>
      </div>
      <div className="e-row">
        <Btn variant="ghost" icon={Minus} onClick={() => onChange({ ...timer, endAt: timer.endAt - 30000, total: Math.max(10, timer.total - 30) })}>30 s</Btn>
        <Btn variant="ghost" icon={Plus} onClick={() => onChange({ ...timer, endAt: timer.endAt + 30000, total: timer.total + 30 })}>30 s</Btn>
      </div>
      <div className="e-row">
        <Btn variant="outline" onClick={() => setHidden(true)}>Ocultar</Btn>
        <Btn variant={left === 0 ? "ok" : "primary"} icon={left === 0 ? Check : SkipForward} onClick={() => onChange(null)}>{left === 0 ? "Siguiente serie" : "Saltar"}</Btn>
      </div>
    </div>
  );
}

/* ---------- Sesión activa ---------- */
function SessionView() {
  const store = useStore();
  const { data } = store;
  const nav = useNav();
  const toast = useToast();
  const exById = useExercisesById();
  const integration = useIntegration();
  const session = useActiveSession();
  const [loadFor, setLoadFor] = useState(null); // {exIndex, setIndex}
  const [timer, setTimer] = useState(null);
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(i); }, []);

  const onTimerDone = useCallback(() => { beep(); integration.notifyRestDone("Descanso terminado. Siguiente serie."); }, [integration]);

  if (summary) return <SessionSummary summary={summary} onClose={() => { setSummary(null); nav.go("entreno", "routines"); }} />;
  if (!session) return <div className="e-page"><Empty icon={Dumbbell}>No hay ninguna sesión en curso.<Btn variant="soft" onClick={() => nav.go("entreno", "routines")}>Ir a rutinas</Btn></Empty></div>;

  const update = (patch) => store.put("sessions", { ...session, ...patch });
  const updateEx = (i, patch) => update({ exercises: session.exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const updateSet = (i, k, patch) => updateEx(i, { sets: session.exercises[i].sets.map((s, l) => (l === k ? { ...s, ...patch } : s)) });
  const mount = (implement, load) => update({ mounted: { ...session.mounted, [implement]: load ? { kg: load.kg, side: load.side, groupSize: load.groupSize || 2 } : null } });
  const elapsed = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);

  const complete = (i, k) => {
    const ex = session.exercises[i], def = exById[ex.exerciseId], s = ex.sets[k];
    if (s.done) { updateSet(i, k, { done: false, pr: false }); return; }
    const last = lastSessionFor(data.sessions, ex.exerciseId, session.id);
    const lastSets = last ? doneSets(last.ex) : [];
    const reps = s.reps !== "" ? num(s.reps) : num(lastSets[k]?.reps ?? ex.sets[k - 1]?.reps, 0);
    if (reps <= 0) { toast("Indica las repeticiones antes de cerrar la serie", "warn"); return; }
    const kg = s.kg == null ? (def.loadMode === "bodyweight" ? 0 : null) : num(s.kg);
    if (kg == null) { toast("Elige una carga antes de cerrar la serie", "warn"); setLoadFor({ exIndex: i, setIndex: k }); return; }
    const rir = s.rir === "" ? "" : clamp(num(s.rir), 0, 6);
    // Validación de carga contra los discos disponibles
    const mode = LOAD_MODES[def.loadMode];
    let mountedNow = session.mounted || {};
    if (mode.implement) {
      const loads = loadsFor(def, data.inventory, data.settings, session.mounted);
      const v = validateLoad(kg, loads);
      if (!v.ok) { toast(`${fmtKg(kg)} kg no es montable ahora con tus discos. Elige otra carga.`, "err"); setLoadFor({ exIndex: i, setIndex: k }); return; }
      // monta la carga en su implemento; se guarda en la misma actualización de abajo
      mountedNow = { ...mountedNow, [mode.implement]: { kg: v.load.kg, side: v.load.side, groupSize: v.load.groupSize || 2 } };
    }
    const best = bestFor(data.sessions, ex.exerciseId, { excludeSessionId: session.id });
    const score = kg > 0 ? epley(kg, reps) : reps;
    const prevInSession = ex.sets.filter((x, l) => l !== k && x.done).map((x) => (num(x.kg) > 0 ? epley(num(x.kg), num(x.reps)) : num(x.reps)));
    const pr = score > (best?.score || 0) && score > Math.max(0, ...prevInSession);
    const sets = ex.sets.map((x, l) => (l === k ? { ...x, kg, reps, rir, done: true, pr } : x));
    const allDone = sets.every((x) => x.done);
    const mounted = allDone && mode.implement ? { ...mountedNow, [mode.implement]: null } : mountedNow;
    store.put("sessions", { ...session, mounted, exercises: session.exercises.map((e, j) => (j === i ? { ...e, sets } : e)) });
    if (pr) toast(`Récord personal en ${def.name}: ${kg > 0 ? `${fmtKg(kg)} kg × ${reps}` : `${reps} reps`}`, "ok");
    const rest = num(ex.restSec, data.settings.restDefaultSec);
    if (rest > 0 && !allDone) setTimer({ id: uid(), endAt: Date.now() + rest * 1000, total: rest, exerciseName: def.name });
    else if (rest > 0 && allDone && i < session.exercises.length - 1) setTimer({ id: uid(), endAt: Date.now() + rest * 1000, total: rest, exerciseName: def.name });
  };

  const copyPrev = (i, k) => {
    const ex = session.exercises[i];
    const src = k > 0 ? ex.sets[k - 1] : (() => { const l = lastSessionFor(data.sessions, ex.exerciseId, session.id); return l ? doneSets(l.ex)[0] : null; })();
    if (!src) { toast("No hay serie anterior que repetir", "warn"); return; }
    updateSet(i, k, { kg: src.kg, reps: src.reps, rir: src.rir ?? "" });
  };

  const finish = async () => {
    const exercises = session.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length);
    if (!exercises.length) { toast("No hay series completadas. Puedes descartar la sesión.", "warn"); return; }
    const finishedAt = new Date().toISOString();
    const closed = { ...session, exercises, finishedAt, mounted: { barbell: null, dumbbells: null } };
    closed.tonnage = r1(sessionTonnage(closed, exById));
    store.put("sessions", closed);
    const all = [...data.sessions.filter((s) => s.id !== closed.id), closed];
    const ws = weekStart(closed.date), we = addDays(ws, 6);
    const vol = volumeByMuscle(all, exById, ws, we);
    const weeklyVolume = r1(sum(Object.values(vol)));
    const weeklySessions = all.filter((s) => s.finishedAt && s.date >= ws && s.date <= we).length;
    const adherence = Math.round((weeklySessions / (data.settings.profile.daysPerWeek || 5)) * 100);
    const dayTonnage = r1(sum(all.filter((s) => s.finishedAt && s.date === closed.date).map((s) => sessionTonnage(s, exById))));
    const prs = exercises.flatMap((e) => e.sets.filter((s) => s.pr).map((s) => ({ name: exById[e.exerciseId]?.name, kg: s.kg, reps: s.reps })));
    const summaryText = exercises.map((e) => `${exById[e.exerciseId]?.name}: ${e.sets.map((s) => `${fmtKg(s.kg)}×${s.reps}`).join(", ")}`).join("\n") + `\nTonelaje: ${fmtN(closed.tonnage)} kg · Series: ${sessionSetCount(closed)}` + (prs.length ? `\nRécords: ${prs.map((p) => p.name).join(", ")}` : "");
    const metrics = { weeklyVolume, weeklySessions, adherence, dayTonnage, summaryText };
    setFinishing(false);
    setSummary({ session: closed, metrics, prs, sets: sessionSetCount(closed), duration: Math.floor((new Date(finishedAt) - new Date(session.startedAt)) / 60000) });
    integration.onSessionClose(closed, metrics);
  };
  const discard = () => { if (window.confirm("¿Descartar la sesión en curso? No se guardará nada.")) { store.remove("sessions", session.id); nav.go("entreno", "routines"); } };

  const loadEx = loadFor ? exById[session.exercises[loadFor.exIndex].exerciseId] : null;
  const m = session.mounted || {};
  return (
    <div className="e-page">
      <RestTimer timer={timer} onChange={setTimer} onDone={onTimerDone} />
      <div className="e-header">
        <div className="e-row"><IconBtn icon={ChevronLeft} label="Volver" onClick={() => nav.go("entreno", "routines")} /><div><h1>{session.dayName}</h1><div className="sub">{fmtSecs(elapsed)} · {sessionSetCount(session)} series · {fmtN(sessionTonnage(session, exById))} kg</div></div></div>
        <Btn variant="primary" size="sm" icon={Check} onClick={() => setFinishing(true)}>Terminar</Btn>
      </div>
      <div className="e-chips">
        <Chip icon={Layers} kind={m.barbell ? "acc" : ""}>Barra: {m.barbell ? `${fmtKg(m.barbell.kg)} kg` : "libre"}</Chip>
        <Chip icon={Dumbbell} kind={m.dumbbells ? "acc" : ""}>Mancuernas: {m.dumbbells ? `${fmtKg(m.dumbbells.kg)} kg` : "libres"}</Chip>
      </div>
      {session.exercises.map((ex, i) => {
        const def = exById[ex.exerciseId];
        if (!def) return null;
        const mode = LOAD_MODES[def.loadMode];
        const last = lastSessionFor(data.sessions, ex.exerciseId, session.id);
        const lastSets = last ? doneSets(last.ex) : [];
        const loads = loadsFor(def, data.inventory, data.settings, session.mounted);
        const sug = suggestProgression({ exercise: def, block: { repsMax: ex.repsMax }, last, loads });
        return (
          <Card key={i} flush>
            <div className="e-col" style={{ padding: "14px 16px 0", gap: 6 }}>
              <div className="e-row between">
                <div className="e-stack e-grow"><b style={{ fontSize: 17 }}>{def.name}</b><span className="e-muted">{def.muscle} · {mode.unit} · descanso {ex.restSec}s</span></div>
                <IconBtn small icon={Trash2} label="Quitar ejercicio" onClick={() => update({ exercises: session.exercises.filter((_, j) => j !== i) })} />
              </div>
              {lastSets.length > 0 && <div className="e-muted"><Repeat style={{ width: 13, verticalAlign: -2 }} /> Última ({fmtDateShort(last.date)}): {lastSets.map((s) => `${num(s.kg) > 0 ? fmtKg(s.kg) + "×" : ""}${s.reps}`).join(" · ")}{lastSets.some((s) => s.rir !== "" && s.rir != null) ? ` · RIR ${Math.min(...lastSets.map((s) => num(s.rir, 9)))}` : ""}</div>}
              {sug && <div className="e-note acc" style={{ padding: "8px 10px" }}><Sparkles /><span>{sug.text}</span></div>}
            </div>
            <div style={{ padding: "10px 12px 12px" }}>
              <div className="e-sets">
                <span className="h">#</span><span className="h">{def.loadMode === "bodyweight" ? "lastre" : "kg"}</span><span className="h">{def.muscle === "core" && def.loadMode === "bodyweight" ? "reps/s" : "reps"}</span><span className="h">RIR</span><span className="h">=</span><span className="h">✓</span>
                {ex.sets.map((s, k) => {
                  const ph = lastSets[k] || lastSets[lastSets.length - 1];
                  return (
                    <div key={k} className={`e-set-row ${s.done ? "done" : ""}`}>
                      <span className="n">{s.pr ? <Trophy /> : k + 1}</span>
                      <button className={`e-cell ${s.kg == null ? "ph" : ""}`} onClick={() => setLoadFor({ exIndex: i, setIndex: k })} disabled={s.done}>
                        {s.kg == null ? (def.loadMode === "bodyweight" ? "PC" : ph ? fmtKg(ph.kg) : "kg") : (def.loadMode === "bodyweight" && num(s.kg) === 0 ? "PC" : fmtKg(s.kg))}
                        {def.loadMode === "pair" || def.loadMode === "single" ? <span className="u">/md</span> : null}
                      </button>
                      <input className="e-cell" type="number" inputMode="numeric" placeholder={ph ? String(ph.reps) : "–"} value={s.reps} disabled={s.done} onChange={(e) => updateSet(i, k, { reps: e.target.value })} aria-label={`Repeticiones serie ${k + 1}`} />
                      <button className={`e-cell ${s.rir === "" ? "ph" : ""}`} disabled={s.done} onClick={() => updateSet(i, k, { rir: s.rir === "" ? 2 : (num(s.rir) + 5) % 6 })} aria-label="RIR">{s.rir === "" ? (ph?.rir ?? "–") : s.rir}</button>
                      <button className="e-copy" onClick={() => copyPrev(i, k)} disabled={s.done} aria-label="Repetir serie anterior" title="Repetir serie anterior"><Copy /></button>
                      <button className={`e-check ${s.done ? "on" : ""}`} onClick={() => complete(i, k)} aria-label={s.done ? "Deshacer" : "Completar serie"}><Check /></button>
                    </div>
                  );
                })}
              </div>
              <div className="e-row" style={{ marginTop: 10 }}>
                <Btn size="sm" variant="outline" icon={Plus} onClick={() => updateEx(i, { sets: [...ex.sets, { kg: ex.sets[ex.sets.length - 1]?.kg ?? null, reps: "", rir: "", done: false, pr: false }] })}>Serie</Btn>
                {ex.sets.length > 1 && <Btn size="sm" variant="outline" icon={Minus} onClick={() => updateEx(i, { sets: ex.sets.slice(0, -1) })}>Serie</Btn>}
                <span className="e-spacer" />
                <div className="e-row" style={{ gap: 4 }}><Timer style={{ width: 16, color: "var(--e-text2)" }} /><input className="e-input" style={{ width: 72, minHeight: 36, padding: "0 10px", textAlign: "center" }} type="number" inputMode="numeric" value={ex.restSec} onChange={(e) => updateEx(i, { restSec: e.target.value })} aria-label="Descanso en segundos" /><span className="e-muted">s</span></div>
              </div>
            </div>
          </Card>
        );
      })}
      <Btn variant="outline" icon={Plus} onClick={() => setPicker(true)}>Añadir ejercicio</Btn>
      <Btn variant="danger" icon={Trash2} onClick={discard}>Descartar sesión</Btn>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} exclude={session.exercises.map((e) => e.exerciseId)}
        onPick={(e) => update({ exercises: [...session.exercises, { exerciseId: e.id, restSec: e.restSec || data.settings.restDefaultSec, repsMin: 8, repsMax: 12, sets: [{ kg: null, reps: "", rir: "", done: false, pr: false }, { kg: null, reps: "", rir: "", done: false, pr: false }, { kg: null, reps: "", rir: "", done: false, pr: false }] }] })} />
      <LoadSheet open={!!loadFor} onClose={() => setLoadFor(null)} exercise={loadEx} session={session}
        currentKg={loadFor ? session.exercises[loadFor.exIndex].sets[loadFor.setIndex].kg : null}
        onUnmount={(impl) => mount(impl, null)}
        onPick={(l) => {
          const impl = LOAD_MODES[loadEx.loadMode].implement;
          const mounted = impl ? { ...session.mounted, [impl]: { kg: l.kg, side: l.side, groupSize: l.groupSize || 2 } } : session.mounted;
          // aplica la carga a esta serie y a las siguientes sin completar
          const exs = session.exercises.map((e, j) => (j === loadFor.exIndex ? { ...e, sets: e.sets.map((s, k) => (k >= loadFor.setIndex && !s.done ? { ...s, kg: l.kg } : s)) } : e));
          store.put("sessions", { ...session, mounted, exercises: exs });
        }} />
      <Sheet open={finishing} onClose={() => setFinishing(false)} title="Terminar sesión">
        <div className="e-row" style={{ gap: 24 }}>
          <div className="e-stack"><span className="e-label">Series</span><span className="e-big sm">{sessionSetCount(session)}</span></div>
          <div className="e-stack"><span className="e-label">Tonelaje</span><span className="e-big sm">{fmtN(sessionTonnage(session, exById))}<span className="e-unit">kg</span></span></div>
          <div className="e-stack"><span className="e-label">Duración</span><span className="e-big sm">{Math.floor(elapsed / 60)}<span className="e-unit">min</span></span></div>
        </div>
        <p className="e-muted">Las series sin completar se descartan. {integration.active ? "Se publicarán las métricas en Home Assistant." : "Home Assistant no está conectado: se guarda solo en local."}</p>
        <Field label="Nota"><Input id="ss-note" value={session.note || ""} onChange={(e) => update({ note: e.target.value })} placeholder="Sensaciones, molestias…" /></Field>
        <Btn variant="primary" full icon={Check} onClick={finish}>Cerrar sesión</Btn>
      </Sheet>
    </div>
  );
}

function CountUp({ value, ms = 900, decimals = 0 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf; const t0 = performance.now();
    const step = (t) => { const p = clamp((t - t0) / ms, 0, 1); setV(value * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{fmtN(v, decimals)}</>;
}
function SessionSummary({ summary, onClose }) {
  const { session, metrics, prs } = summary;
  return (
    <div className="e-page e-countup">
      <div className="e-header"><div><h1>Sesión cerrada</h1><div className="sub">{session.dayName} · {fmtDate(session.date)}</div></div><IconBtn icon={X} label="Cerrar" onClick={onClose} /></div>
      <Card accent>
        <span className="e-label">Tonelaje</span>
        <div className="e-hero"><span className="e-big"><CountUp value={session.tonnage} /></span><span className="e-unit">kg</span></div>
        <div className="e-row" style={{ gap: 24 }}>
          <div className="e-stack"><span className="e-label">Series</span><b style={{ fontSize: 22 }}><CountUp value={summary.sets} /></b></div>
          <div className="e-stack"><span className="e-label">Duración</span><b style={{ fontSize: 22 }}>{summary.duration} min</b></div>
          <div className="e-stack"><span className="e-label">Semana</span><b style={{ fontSize: 22 }}>{metrics.weeklySessions} ses · {metrics.adherence} %</b></div>
        </div>
      </Card>
      {prs.length > 0 && (
        <Card title="Récords personales">
          {prs.map((p, i) => <div key={i} className="e-row between"><span>{p.name}</span><span className="e-pr"><Trophy />{p.kg > 0 ? `${fmtKg(p.kg)} kg × ${p.reps}` : `${p.reps} reps`}</span></div>)}
        </Card>
      )}
      <Btn variant="primary" full onClick={onClose}>Volver</Btn>
    </div>
  );
}

/* ---------- Biblioteca y ficha de ejercicio ---------- */
function ExerciseForm({ open, onClose, exercise }) {
  const store = useStore();
  const toast = useToast();
  const [e, setE] = useState(exercise);
  useEffect(() => { setE(exercise); }, [exercise]);
  if (!e) return null;
  const save = () => {
    if (!e.name.trim()) { toast("El ejercicio necesita nombre", "warn"); return; }
    store.put("exercises", { ...e, restSec: clamp(num(e.restSec, 90), 15, 600), secondary: (e.secondary || []).filter((m) => m !== e.muscle) });
    toast("Ejercicio guardado", "ok"); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={exercise?.isNew ? "Nuevo ejercicio" : "Editar ejercicio"} footer={<Btn variant="primary" full icon={Check} onClick={save}>Guardar</Btn>}>
      <Field label="Nombre"><Input id="ex-name" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
      <div className="e-fields">
        <Field label="Grupo principal"><Select value={e.muscle} options={MUSCLES} onChange={(x) => setE({ ...e, muscle: x.target.value })} /></Field>
        <Field label="Material"><Select value={e.loadMode} options={Object.entries(LOAD_MODES).map(([k, v]) => ({ value: k, label: v.label }))} onChange={(x) => setE({ ...e, loadMode: x.target.value })} /></Field>
        <Field label="Descanso (s)"><Input type="number" inputMode="numeric" value={e.restSec} onChange={(x) => setE({ ...e, restSec: x.target.value })} /></Field>
      </div>
      <Field label="Secundarios">
        <div className="e-chips">{MUSCLES.filter((m) => m !== e.muscle).map((m) => <button key={m} className={`e-chip ${e.secondary?.includes(m) ? "on" : ""}`} onClick={() => setE({ ...e, secondary: e.secondary?.includes(m) ? e.secondary.filter((x) => x !== m) : [...(e.secondary || []), m] })}>{m}</button>)}</div>
      </Field>
      <Toggle label="Usa el banco" on={e.bench} onChange={(v) => setE({ ...e, bench: v })} />
      <Toggle label="Unilateral" hint="El peso se registra por lado" on={e.unilateral} onChange={(v) => setE({ ...e, unilateral: v })} />
      <Toggle label="Tren inferior" hint="Prioriza progresar por dificultad mecánica" on={e.lower} onChange={(v) => setE({ ...e, lower: v })} />
      <Field label="Técnica"><textarea className="e-textarea" style={{ fontFamily: "inherit", fontSize: 14, minHeight: 90 }} value={e.notes || ""} onChange={(x) => setE({ ...e, notes: x.target.value })} /></Field>
    </Sheet>
  );
}

function ExerciseDetail({ exercise, onBack }) {
  const store = useStore();
  const { data } = store;
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const def = data.exercises.find((e) => e.id === exercise.id) || exercise;
  const hist = e1rmHistory(data.sessions, def.id);
  const best = bestFor(data.sessions, def.id);
  const loads = loadsFor(def, data.inventory, data.settings, {});
  const mode = LOAD_MODES[def.loadMode];
  const recent = data.sessions.filter((s) => s.finishedAt && s.exercises.some((e) => e.exerciseId === def.id && doneSets(e).length)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  const usedIn = data.routines.filter((r) => r.days.some((d) => d.blocks.some((b) => b.exerciseId === def.id)));
  const remove = () => {
    if (usedIn.length) { toast(`Está en ${usedIn.map((r) => r.name).join(", ")}. Quítalo de las rutinas primero.`, "warn"); return; }
    if (!window.confirm(`¿Eliminar «${def.name}»? El historial de sesiones se conserva.`)) return;
    store.remove("exercises", def.id); onBack();
  };
  return (
    <div className="e-page">
      <div className="e-header">
        <div className="e-row"><IconBtn icon={ChevronLeft} label="Volver" onClick={onBack} /><div><h1>{def.name}</h1><div className="sub">{def.muscle}{def.secondary?.length ? ` · ${def.secondary.join(", ")}` : ""}</div></div></div>
        <div className="e-header-actions"><IconBtn icon={Pencil} label="Editar" onClick={() => setEdit(true)} /><IconBtn icon={Trash2} label="Eliminar" onClick={remove} /></div>
      </div>
      <div className="e-chips">
        <Chip icon={Dumbbell}>{EQUIPMENT_LABEL[def.loadMode]}</Chip>
        {def.bench && <Chip>banco</Chip>}{def.unilateral && <Chip>unilateral</Chip>}{def.lower && <Chip>tren inferior</Chip>}
        <Chip icon={Timer}>{def.restSec} s</Chip>
      </div>
      <div className="e-grid2">
        <Card title="Mejor marca">
          {best ? (
            <div className="e-hero"><span className="e-big md">{best.kg > 0 ? fmtKg(best.e1rm) : best.reps}</span><span className="e-unit">{best.kg > 0 ? "kg 1RM est." : "reps"}</span><span className="e-muted" style={{ marginLeft: "auto" }}>{best.kg > 0 ? `${fmtKg(best.kg)} × ${best.reps}` : ""} · {fmtDateShort(best.date)}</span></div>
          ) : <p className="e-muted">Sin registros todavía.</p>}
          {hist.length > 1 && (
            <div className="e-chart">
              <ResponsiveContainer>
                <LineChart data={hist.map((h) => ({ ...h, d: fmtDateShort(h.date) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--e-div)" vertical={false} />
                  <XAxis dataKey="d" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} domain={["auto", "auto"]} width={40} tickFormatter={(v) => fmtKg(v)} />
                  <Tooltip content={<ChartTip fmt={(v) => `${fmtKg(v)} kg`} />} />
                  <Line type="monotone" dataKey="e1rm" name="1RM estimado" stroke="var(--e-acc)" strokeWidth={2} dot={{ r: 3, fill: "var(--e-acc)", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Técnica"><p style={{ fontSize: 14 }}>{def.notes || "Sin notas."}</p></Card>
      </div>
      <Card title={`Cargas montables · ${mode.unit}`}>
        <div className="e-chips">{loads.map((l) => <Chip key={l.kg} title={l.label}>{fmtKg(l.kg)}</Chip>)}</div>
        <p className="e-muted">Con todos los discos libres. Durante la sesión se descuentan los montados en el otro implemento.</p>
      </Card>
      <Card title="Historial" flush>
        <div className="e-list" style={{ marginTop: 8 }}>
          {recent.map((s) => { const ex = s.exercises.find((e) => e.exerciseId === def.id); return (
            <div key={s.id} className="e-item"><span className="e-grow e-stack"><span className="t">{fmtDate(s.date, true)}</span><span className="s">{s.dayName}</span></span><span className="v" style={{ fontWeight: 500, textAlign: "right", whiteSpace: "normal" }}>{doneSets(ex).map((x, i) => <span key={i}>{x.pr && <Trophy style={{ width: 12, color: "var(--e-warn)", verticalAlign: -1 }} />}{num(x.kg) > 0 ? `${fmtKg(x.kg)}×` : ""}{x.reps}{i < doneSets(ex).length - 1 ? " · " : ""}</span>)}</span></div>
          ); })}
          {!recent.length && <Empty icon={Calendar}>Todavía no has registrado este ejercicio.</Empty>}
        </div>
      </Card>
      <ExerciseForm open={edit} onClose={() => setEdit(false)} exercise={def} />
    </div>
  );
}

function LibraryView() {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const [m, setM] = useState("");
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(null);
  const list = data.exercises.filter((e) => (!m || e.muscle === m || e.secondary?.includes(m)) && (!q || e.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  if (sel) return <ExerciseDetail exercise={sel} onBack={() => setSel(null)} />;
  return (
    <div className="e-page">
      <div className="e-row">
        <div className="e-grow" style={{ position: "relative" }}><Search style={{ position: "absolute", left: 14, top: 14, width: 18, color: "var(--e-text2)" }} /><Input id="lib-q" placeholder="Buscar ejercicio" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 40 }} /></div>
        <Btn variant="soft" icon={Plus} onClick={() => setCreating({ id: uid(), isNew: true, name: "", muscle: "pecho", secondary: [], loadMode: "barbell", bench: false, unilateral: false, lower: false, restSec: 90, notes: "" })}>Nuevo</Btn>
      </div>
      <div className="e-chips scroll">
        <button className={`e-chip ${!m ? "on" : ""}`} onClick={() => setM("")}>Todos</button>
        {MUSCLES.map((x) => <button key={x} className={`e-chip ${m === x ? "on" : ""}`} onClick={() => setM(x)}>{x}</button>)}
      </div>
      <Card flush>
        <div className="e-list">
          {list.map((e) => { const b = bestFor(data.sessions, e.id); return (
            <button key={e.id} className="e-item" onClick={() => setSel(e)}>
              <span className="e-grow e-stack"><span className="t">{e.name}</span><span className="s">{e.muscle} · {EQUIPMENT_LABEL[e.loadMode]}</span></span>
              {b && <span className="v e-muted" style={{ fontSize: 13 }}>{b.kg > 0 ? `${fmtKg(b.e1rm)} kg` : `${b.reps} reps`}</span>}
              <ChevronRight style={{ width: 18, color: "var(--e-text2)" }} />
            </button>
          ); })}
          {!list.length && <Empty icon={Search}>Sin resultados</Empty>}
        </div>
      </Card>
      <p className="e-muted">{data.exercises.length} ejercicios, todos ejecutables con tu material.</p>
      <ExerciseForm open={!!creating} onClose={() => setCreating(null)} exercise={creating} />
    </div>
  );
}

/* ---------- Calendario ---------- */
function CalendarView() {
  const { data } = useStore();
  const exById = useExercisesById();
  const t = todayISO();
  const [ym, setYm] = useState(t.slice(0, 7));
  const [sel, setSel] = useState(t);
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, mo, 0).getDate();
  const trained = new Set(data.sessions.filter((s) => s.finishedAt).map((s) => s.date));
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${ym}-${pad2(d)}`);
  const shift = (n) => { const d = new Date(y, mo - 1 + n, 1); setYm(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); };
  const daySessions = data.sessions.filter((s) => s.finishedAt && s.date === sel);
  const monthCount = [...trained].filter((d) => d.startsWith(ym)).length;
  return (
    <div className="e-page">
      <Card>
        <div className="e-row between">
          <IconBtn icon={ChevronLeft} label="Mes anterior" onClick={() => shift(-1)} />
          <div className="e-stack" style={{ alignItems: "center" }}><b style={{ fontSize: 17, textTransform: "capitalize" }}>{MONTHS_ES[mo - 1]} {y}</b><span className="e-muted">{monthCount} días entrenados</span></div>
          <IconBtn icon={ChevronRight} label="Mes siguiente" onClick={() => shift(1)} />
        </div>
        <div className="e-cal">
          {DAYS_ES.map((d) => <span key={d} className="wd">{d}</span>)}
          {cells.map((c, i) => c ? (
            <button key={c} className={`e-cal day ${trained.has(c) ? "on" : ""} ${c === t ? "today" : ""} ${c === sel ? "sel" : ""}`} style={{ display: "flex" }} onClick={() => setSel(c)}>{Number(c.slice(-2))}<span className="m" /></button>
          ) : <span key={`x${i}`} />)}
        </div>
      </Card>
      <Card title={fmtDate(sel, true)} flush>
        <div className="e-list" style={{ marginTop: 8 }}>
          {daySessions.map((s) => (
            <div key={s.id} className="e-item" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
              <div className="e-row between" style={{ width: "100%" }}><b>{s.dayName}</b><span className="e-muted">{sessionSetCount(s)} series · {fmtN(sessionTonnage(s, exById))} kg</span></div>
              {s.exercises.map((e, i) => <div key={i} className="e-row between" style={{ width: "100%", fontSize: 13 }}><span className="e-muted e-ellip">{exById[e.exerciseId]?.name || e.exerciseId}</span><span>{doneSets(e).map((x) => `${num(x.kg) > 0 ? fmtKg(x.kg) + "×" : ""}${x.reps}`).join(" · ")}</span></div>)}
              {s.note && <span className="e-muted">«{s.note}»</span>}
            </div>
          ))}
          {!daySessions.length && <Empty icon={Calendar}>Sin entrenamiento este día.</Empty>}
        </div>
      </Card>
    </div>
  );
}

function TrainScreen() {
  const nav = useNav();
  const active = useActiveSession();
  const view = nav.view || (active ? "session" : "routines");
  const tabs = [{ value: "routines", label: "Rutinas" }, { value: "library", label: "Biblioteca" }, { value: "calendar", label: "Calendario" }];
  if (view === "session") return <SessionView />;
  return (
    <>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 0" }}><Segmented options={tabs} value={view} onChange={(v) => nav.go("entreno", v)} /></div>
      {view === "routines" && <RoutinesView />}
      {view === "library" && <LibraryView />}
      {view === "calendar" && <CalendarView />}
    </>
  );
}

/* =============================================================================
 * MÓDULO DE ALIMENTACIÓN
 * ========================================================================== */
const MEALS = [["desayuno", "Desayuno"], ["comida", "Comida"], ["cena", "Cena"], ["snacks", "Snacks"]];
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
const addM = (a, b, f = 1) => ({ kcal: a.kcal + b.kcal * f, protein: a.protein + b.protein * f, carbs: a.carbs + b.carbs * f, fat: a.fat + b.fat * f });
const foodMacros = (food, qty) => { const f = food.per === "100g" ? qty / 100 : qty; return { kcal: food.kcal * f, protein: food.protein * f, carbs: food.carbs * f, fat: food.fat * f }; };
function recipeTotals(recipe, foodsById) {
  return recipe.items.reduce((acc, it) => (foodsById[it.foodId] ? addM(acc, foodMacros(foodsById[it.foodId], num(it.qty))) : acc), ZERO);
}
function entryInfo(entry, foodsById, recipesById) {
  if (entry.recipeId) {
    const r = recipesById[entry.recipeId];
    if (!r) return { name: "Receta eliminada", qtyLabel: "", m: ZERO };
    const per = recipeTotals(r, foodsById);
    const f = num(entry.qty) / (r.servings || 1);
    return { name: r.name, qtyLabel: `${fmtN(entry.qty, 1)} ración${num(entry.qty) === 1 ? "" : "es"}`, m: addM(ZERO, per, f), isRecipe: true };
  }
  const food = foodsById[entry.foodId];
  if (!food) return { name: "Alimento eliminado", qtyLabel: "", m: ZERO };
  return { name: food.name, qtyLabel: food.per === "100g" ? `${fmtN(entry.qty)} g` : `${fmtN(entry.qty, 1)} × ${food.unitLabel || "ud"}`, m: foodMacros(food, num(entry.qty)) };
}
function dayTotals(rec, foodsById, recipesById) {
  const byMeal = {};
  let total = ZERO;
  for (const [key] of MEALS) {
    const t = (rec?.meals?.[key] || []).reduce((acc, e) => addM(acc, entryInfo(e, foodsById, recipesById).m), ZERO);
    byMeal[key] = t; total = addM(total, t);
  }
  return { total, byMeal };
}
const emptyDiary = (date) => ({ date, meals: { desayuno: [], comida: [], cena: [], snacks: [] }, waterMl: 0 });
function useDiaryDay(date) {
  const store = useStore();
  const rec = store.data.diary.find((d) => d.date === date) || emptyDiary(date);
  const save = (patch) => store.put("diary", { ...rec, ...patch });
  return { rec, save };
}
function useFoodMaps() {
  const { data } = useStore();
  return useMemo(() => ({
    foodsById: Object.fromEntries(data.foods.map((f) => [f.id, f])),
    recipesById: Object.fromEntries(data.recipes.map((r) => [r.id, r])),
  }), [data.foods, data.recipes]);
}

function FoodForm({ open, onClose, food }) {
  const store = useStore();
  const toast = useToast();
  const [f, setF] = useState(food);
  useEffect(() => { setF(food); }, [food]);
  if (!f) return null;
  const save = () => {
    if (!f.name.trim()) { toast("El alimento necesita nombre", "warn"); return; }
    store.put("foods", { ...f, kcal: num(f.kcal), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) });
    toast("Alimento guardado", "ok"); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={food?.isNew ? "Nuevo alimento" : "Editar alimento"} footer={<Btn variant="primary" full icon={Check} onClick={save}>Guardar</Btn>}>
      <Field label="Nombre"><Input id="food-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Segmented options={[{ value: "100g", label: "Por 100 g" }, { value: "unit", label: "Por unidad" }]} value={f.per} onChange={(v) => setF({ ...f, per: v })} />
      {f.per === "unit" && <Field label="Nombre de la unidad"><Input value={f.unitLabel || ""} placeholder="p. ej. unidad 120 g" onChange={(e) => setF({ ...f, unitLabel: e.target.value })} /></Field>}
      <div className="e-fields">
        <Field label="kcal"><Input type="number" inputMode="decimal" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} /></Field>
        <Field label="Proteína g"><Input type="number" inputMode="decimal" value={f.protein} onChange={(e) => setF({ ...f, protein: e.target.value })} /></Field>
        <Field label="Carbohidratos g"><Input type="number" inputMode="decimal" value={f.carbs} onChange={(e) => setF({ ...f, carbs: e.target.value })} /></Field>
        <Field label="Grasa g"><Input type="number" inputMode="decimal" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

function AddFoodSheet({ open, onClose, onAdd }) {
  const { data } = useStore();
  const { foodsById } = useFoodMaps();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("foods");
  const [sel, setSel] = useState(null);
  const [qty, setQty] = useState("");
  useEffect(() => { if (open) { setSel(null); setQty(""); setQ(""); } }, [open]);
  const list = kind === "foods"
    ? data.foods.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))
    : data.recipes.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const isRecipe = sel && sel.servings != null;
  const preview = sel ? (isRecipe ? addM(ZERO, recipeTotals(sel, foodsById), num(qty) / (sel.servings || 1)) : foodMacros(sel, num(qty))) : null;
  return (
    <Sheet open={open} onClose={onClose} title="Añadir a la comida">
      {!sel ? (<>
        <Segmented options={[{ value: "foods", label: "Alimentos" }, { value: "recipes", label: "Recetas" }]} value={kind} onChange={setKind} />
        <Input id="add-q" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="e-list">
          {list.map((x) => (
            <button key={x.id} className="e-item" onClick={() => { setSel(x); setQty(x.servings != null ? "1" : x.per === "unit" ? "1" : "100"); }}>
              <span className="e-grow e-stack"><span className="t">{x.name}</span><span className="s">{x.servings != null ? `${fmtN(recipeTotals(x, foodsById).kcal / x.servings)} kcal / ración` : `${fmtN(x.kcal)} kcal · P ${fmtN(x.protein)} · C ${fmtN(x.carbs)} · G ${fmtN(x.fat)} ${x.per === "100g" ? "/ 100 g" : "/ " + (x.unitLabel || "ud")}`}</span></span>
              <Plus style={{ width: 18, color: "var(--e-text2)" }} />
            </button>
          ))}
          {!list.length && <Empty icon={Search}>Sin resultados</Empty>}
        </div>
      </>) : (<>
        <div className="e-row"><IconBtn small icon={ChevronLeft} label="Atrás" onClick={() => setSel(null)} /><b style={{ fontSize: 17 }}>{sel.name}</b></div>
        <Field label={isRecipe ? "Raciones" : sel.per === "100g" ? "Cantidad en gramos" : `Unidades (${sel.unitLabel || "ud"})`}>
          <Input id="add-qty" type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        {!isRecipe && sel.per === "100g" && <div className="e-chips">{[50, 100, 150, 200, 250].map((g) => <button key={g} className="e-chip" onClick={() => setQty(String(g))}>{g} g</button>)}</div>}
        <div className="e-row" style={{ gap: 20 }}>
          <div className="e-stack"><span className="e-label">kcal</span><b style={{ fontSize: 22 }}>{fmtN(preview.kcal)}</b></div>
          <div className="e-stack"><span className="e-label">Prot</span><b style={{ fontSize: 22 }}>{fmtN(preview.protein)}</b></div>
          <div className="e-stack"><span className="e-label">Carb</span><b style={{ fontSize: 22 }}>{fmtN(preview.carbs)}</b></div>
          <div className="e-stack"><span className="e-label">Grasa</span><b style={{ fontSize: 22 }}>{fmtN(preview.fat)}</b></div>
        </div>
        <Btn variant="primary" full icon={Plus} disabled={num(qty) <= 0} onClick={() => { onAdd(isRecipe ? { recipeId: sel.id, qty: num(qty) } : { foodId: sel.id, qty: num(qty) }); onClose(); }}>Añadir</Btn>
      </>)}
    </Sheet>
  );
}

function DiaryView() {
  const store = useStore();
  const { data } = store;
  const toast = useToast();
  const integration = useIntegration();
  const { foodsById, recipesById } = useFoodMaps();
  const [date, setDate] = useState(todayISO());
  const { rec, save } = useDiaryDay(date);
  const [adding, setAdding] = useState(null); // clave de comida
  const [editing, setEditing] = useState(null); // {meal, index}
  const g = data.settings.goals;
  const totals = dayTotals(rec, foodsById, recipesById);
  const left = g.kcal - totals.total.kcal;

  // Publica la proteína restante de hoy hacia HA (con retardo para no saturar).
  const proteinLeft = Math.round(g.protein - dayTotals(data.diary.find((d) => d.date === todayISO()) || null, foodsById, recipesById).total.protein);
  const pubRef = useRef(integration.publishProteinLeft); pubRef.current = integration.publishProteinLeft;
  useEffect(() => { if (!integration.active) return; const t = setTimeout(() => pubRef.current(proteinLeft), 1500); return () => clearTimeout(t); }, [proteinLeft, integration.active]);

  const addEntry = (meal, entry) => save({ meals: { ...rec.meals, [meal]: [...(rec.meals[meal] || []), entry] } });
  const setEntry = (meal, i, entry) => save({ meals: { ...rec.meals, [meal]: rec.meals[meal].map((e, j) => (j === i ? entry : e)) } });
  const delEntry = (meal, i) => save({ meals: { ...rec.meals, [meal]: rec.meals[meal].filter((_, j) => j !== i) } });
  const shopping = () => {
    const agg = new Map();
    for (const [key] of MEALS) for (const e of rec.meals[key] || []) {
      if (e.recipeId) { const r = recipesById[e.recipeId]; if (!r) continue; for (const it of r.items) agg.set(it.foodId, (agg.get(it.foodId) || 0) + num(it.qty) * num(e.qty) / (r.servings || 1)); }
      else agg.set(e.foodId, (agg.get(e.foodId) || 0) + num(e.qty));
    }
    const items = [...agg.entries()].map(([id, q]) => { const f = foodsById[id]; return f ? `${f.name} · ${f.per === "100g" ? `${fmtN(q)} g` : `${fmtN(q, 1)} ${f.unitLabel || "ud"}`}` : null; }).filter(Boolean);
    if (!items.length) { toast("No hay alimentos en este día", "warn"); return; }
    if (!integration.active) { toast("Home Assistant no está conectado. Lista: " + items.join(", "), "warn", 8000); return; }
    integration.sendShoppingList(items);
  };
  const ed = editing ? rec.meals[editing.meal][editing.index] : null;
  return (
    <div className="e-page">
      <div className="e-row between">
        <IconBtn icon={ChevronLeft} label="Día anterior" onClick={() => setDate(addDays(date, -1))} />
        <button className="e-stack" style={{ alignItems: "center" }} onClick={() => setDate(todayISO())}><b style={{ fontSize: 17 }}>{date === todayISO() ? "Hoy" : fmtDate(date)}</b><span className="e-muted">{date === todayISO() ? fmtDate(date) : "tocar para volver a hoy"}</span></button>
        <IconBtn icon={ChevronRight} label="Día siguiente" onClick={() => setDate(addDays(date, 1))} />
      </div>
      <Card>
        <div className="e-rings">
          <Ring value={totals.total.kcal} max={g.kcal} size={112} stroke={10}><b>{fmtN(Math.abs(left))}</b><span>{left >= 0 ? "restantes" : "de más"}</span></Ring>
          <div className="e-grow e-col" style={{ gap: 10 }}>
            <div className="e-stack"><span className="e-label">Consumidas</span><b style={{ fontSize: 17 }}>{fmtN(totals.total.kcal)} <span className="e-muted" style={{ fontWeight: 400 }}>/ {fmtN(g.kcal)} kcal</span></b></div>
            <MacroBar label="Proteína" value={totals.total.protein} max={g.protein} />
            <MacroBar label="Carbohidratos" value={totals.total.carbs} max={g.carbs} />
            <MacroBar label="Grasa" value={totals.total.fat} max={g.fat} />
          </div>
        </div>
      </Card>
      {MEALS.map(([key, label]) => (
        <Card key={key} flush>
          <div className="e-card-head" style={{ padding: "14px 16px 6px" }}>
            <div className="e-stack"><h2 className="e-card-title big">{label}</h2><span className="e-muted">{fmtN(totals.byMeal[key].kcal)} kcal · P {fmtN(totals.byMeal[key].protein)} · C {fmtN(totals.byMeal[key].carbs)} · G {fmtN(totals.byMeal[key].fat)}</span></div>
            <Btn size="sm" variant="soft" icon={Plus} onClick={() => setAdding(key)}>Añadir</Btn>
          </div>
          <div className="e-list">
            {(rec.meals[key] || []).map((e, i) => { const info = entryInfo(e, foodsById, recipesById); return (
              <button key={i} className="e-item" style={{ minHeight: 48 }} onClick={() => setEditing({ meal: key, index: i })}>
                <span className="e-grow e-stack"><span className="t">{info.isRecipe && <BookOpen style={{ width: 13, verticalAlign: -2, marginRight: 4, color: "var(--e-text2)" }} />}{info.name}</span><span className="s">{info.qtyLabel} · P {fmtN(info.m.protein)} · C {fmtN(info.m.carbs)} · G {fmtN(info.m.fat)}</span></span>
                <span className="v">{fmtN(info.m.kcal)}<span className="e-muted" style={{ fontWeight: 400 }}> kcal</span></span>
              </button>
            ); })}
          </div>
        </Card>
      ))}
      <Card>
        <div className="e-row between">
          <div className="e-rings">
            <Ring value={rec.waterMl} max={g.waterMl} size={72} stroke={7}><Droplets style={{ width: 20, color: "var(--e-acc)" }} /></Ring>
            <div className="e-stack"><span className="e-label">Agua</span><div className="e-hero"><span className="e-big sm">{fmtN(rec.waterMl / 1000, 2)}</span><span className="e-unit">/ {fmtN(g.waterMl / 1000, 1)} l</span></div></div>
          </div>
          <div className="e-row"><Btn size="sm" variant="outline" icon={Minus} onClick={() => save({ waterMl: Math.max(0, rec.waterMl - 250) })} aria-label="Quitar 250 ml" /><Btn size="sm" variant="soft" onClick={() => save({ waterMl: rec.waterMl + 250 })}>+250</Btn><Btn size="sm" variant="soft" onClick={() => save({ waterMl: rec.waterMl + 500 })}>+500</Btn></div>
        </div>
      </Card>
      <Btn variant="outline" icon={ShoppingCart} onClick={shopping}>Enviar ingredientes a la lista de la compra</Btn>
      <AddFoodSheet open={!!adding} onClose={() => setAdding(null)} onAdd={(e) => addEntry(adding, e)} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={ed ? entryInfo(ed, foodsById, recipesById).name : ""}>
        {ed && (<>
          <Field label={ed.recipeId ? "Raciones" : foodsById[ed.foodId]?.per === "100g" ? "Gramos" : "Unidades"}><Input id="edit-qty" type="number" inputMode="decimal" value={ed.qty} onChange={(e) => setEntry(editing.meal, editing.index, { ...ed, qty: e.target.value })} /></Field>
          <Field label="Mover a"><Select value={editing.meal} options={MEALS.map(([v, l]) => ({ value: v, label: l }))} onChange={(e) => { const to = e.target.value; if (to === editing.meal) return; const entry = { ...ed, qty: num(ed.qty) }; save({ meals: { ...rec.meals, [editing.meal]: rec.meals[editing.meal].filter((_, j) => j !== editing.index), [to]: [...(rec.meals[to] || []), entry] } }); setEditing(null); }} /></Field>
          <div className="e-row"><Btn variant="danger" icon={Trash2} onClick={() => { delEntry(editing.meal, editing.index); setEditing(null); }}>Quitar</Btn><Btn variant="primary" className="e-grow" onClick={() => { setEntry(editing.meal, editing.index, { ...ed, qty: num(ed.qty) }); setEditing(null); }}>Listo</Btn></div>
        </>)}
      </Sheet>
    </div>
  );
}

function FoodsView() {
  const store = useStore();
  const { data } = store;
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const list = data.foods.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="e-page">
      <div className="e-row">
        <Input id="foods-q" className="e-grow" placeholder="Buscar alimento" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn variant="soft" icon={Plus} onClick={() => setEditing({ id: uid(), isNew: true, name: "", per: "100g", unitLabel: "", kcal: "", protein: "", carbs: "", fat: "" })}>Nuevo</Btn>
      </div>
      <Card flush>
        <div className="e-list">
          {list.map((f) => (
            <button key={f.id} className="e-item" onClick={() => setEditing(f)}>
              <span className="e-grow e-stack"><span className="t">{f.name}</span><span className="s">P {fmtN(f.protein, 1)} · C {fmtN(f.carbs, 1)} · G {fmtN(f.fat, 1)} · {f.per === "100g" ? "por 100 g" : `por ${f.unitLabel || "unidad"}`}</span></span>
              <span className="v">{fmtN(f.kcal)}<span className="e-muted" style={{ fontWeight: 400 }}> kcal</span></span>
            </button>
          ))}
          {!list.length && <Empty icon={Search}>Sin resultados</Empty>}
        </div>
      </Card>
      <FoodForm open={!!editing} onClose={() => setEditing(null)} food={editing} />
      {editing && !editing.isNew && <div style={{ display: "none" }} />}
    </div>
  );
}

function RecipesView() {
  const store = useStore();
  const { data } = store;
  const toast = useToast();
  const { foodsById } = useFoodMaps();
  const [r, setR] = useState(null);
  const [picking, setPicking] = useState(false);
  const [pq, setPq] = useState("");
  const save = () => {
    if (!r.name.trim()) { toast("La receta necesita nombre", "warn"); return; }
    store.put("recipes", { ...r, servings: Math.max(1, num(r.servings, 1)), items: r.items.map((it) => ({ ...it, qty: num(it.qty) })).filter((it) => it.qty > 0) });
    toast("Receta guardada", "ok"); setR(null);
  };
  const remove = () => { if (window.confirm(`¿Eliminar «${r.name}»?`)) { store.remove("recipes", r.id); setR(null); } };
  return (
    <div className="e-page">
      <div className="e-row between"><span className="e-muted">{data.recipes.length} recetas</span><Btn variant="soft" icon={Plus} onClick={() => setR({ id: uid(), isNew: true, name: "", servings: 1, items: [] })}>Nueva</Btn></div>
      <Card flush>
        <div className="e-list">
          {data.recipes.map((x) => { const t = recipeTotals(x, foodsById); return (
            <button key={x.id} className="e-item" onClick={() => setR(JSON.parse(JSON.stringify(x)))}>
              <span className="e-grow e-stack"><span className="t">{x.name}</span><span className="s">{x.items.length} ingredientes · {x.servings} ración{x.servings > 1 ? "es" : ""} · P {fmtN(t.protein / x.servings)} · C {fmtN(t.carbs / x.servings)} · G {fmtN(t.fat / x.servings)}</span></span>
              <span className="v">{fmtN(t.kcal / x.servings)}<span className="e-muted" style={{ fontWeight: 400 }}> kcal</span></span>
            </button>
          ); })}
          {!data.recipes.length && <Empty icon={BookOpen}>Todavía no hay recetas.</Empty>}
        </div>
      </Card>
      <Sheet open={!!r} onClose={() => setR(null)} title={r?.isNew ? "Nueva receta" : "Editar receta"} footer={r && <div className="e-row">{!r.isNew && <Btn variant="danger" icon={Trash2} onClick={remove} />}<Btn variant="primary" className="e-grow" icon={Check} onClick={save}>Guardar</Btn></div>}>
        {r && (<>
          <div className="e-fields" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Field label="Nombre"><Input id="rc-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
            <Field label="Raciones"><Input type="number" inputMode="numeric" value={r.servings} onChange={(e) => setR({ ...r, servings: e.target.value })} /></Field>
          </div>
          <div className="e-list">
            {r.items.map((it, i) => { const f = foodsById[it.foodId]; return (
              <div key={i} className="e-item" style={{ padding: "8px 0" }}>
                <span className="e-grow e-stack"><span className="t">{f?.name || "?"}</span><span className="s">{f ? `${fmtN(foodMacros(f, num(it.qty)).kcal)} kcal` : ""}</span></span>
                <Input type="number" inputMode="decimal" style={{ width: 90 }} value={it.qty} onChange={(e) => setR({ ...r, items: r.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} aria-label="Cantidad" />
                <span className="e-muted" style={{ width: 24 }}>{f?.per === "100g" ? "g" : "ud"}</span>
                <IconBtn small icon={Trash2} label="Quitar" onClick={() => setR({ ...r, items: r.items.filter((_, j) => j !== i) })} />
              </div>
            ); })}
          </div>
          {(() => { const t = recipeTotals(r, foodsById); const s = Math.max(1, num(r.servings, 1)); return <div className="e-note"><Info /><span>Por ración: <b>{fmtN(t.kcal / s)} kcal</b> · P {fmtN(t.protein / s)} · C {fmtN(t.carbs / s)} · G {fmtN(t.fat / s)}</span></div>; })()}
          {!picking ? <Btn variant="outline" icon={Plus} onClick={() => { setPicking(true); setPq(""); }}>Añadir ingrediente</Btn> : (
            <div className="e-col">
              <Input placeholder="Buscar alimento…" value={pq} onChange={(e) => setPq(e.target.value)} autoFocus />
              <div className="e-list" style={{ maxHeight: 220, overflowY: "auto" }}>
                {data.foods.filter((f) => !pq || f.name.toLowerCase().includes(pq.toLowerCase())).slice(0, 30).map((f) => (
                  <button key={f.id} className="e-item" style={{ minHeight: 44 }} onClick={() => { setR({ ...r, items: [...r.items, { foodId: f.id, qty: f.per === "100g" ? 100 : 1 }] }); setPicking(false); }}><span className="e-grow t">{f.name}</span><Plus style={{ width: 16, color: "var(--e-text2)" }} /></button>
                ))}
              </div>
            </div>
          )}
        </>)}
      </Sheet>
    </div>
  );
}

function FoodScreen() {
  const nav = useNav();
  const view = nav.view || "diary";
  const tabs = [{ value: "diary", label: "Diario" }, { value: "foods", label: "Alimentos" }, { value: "recipes", label: "Recetas" }];
  return (
    <>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 0" }}><Segmented options={tabs} value={view} onChange={(v) => nav.go("comida", v)} /></div>
      {view === "diary" && <DiaryView />}
      {view === "foods" && <FoodsView />}
      {view === "recipes" && <RecipesView />}
    </>
  );
}

/* =============================================================================
 * PANTALLA PRINCIPAL · HOY
 * ========================================================================== */
function WeekDots({ sessions, daysPerWeek }) {
  const t = todayISO(), ws = weekStart(t);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const trained = new Set(sessions.filter((s) => s.finishedAt).map((s) => s.date));
  const n = days.filter((d) => trained.has(d)).length;
  return (
    <div className="e-col">
      <div className="e-week">{days.map((d, i) => <div key={d} className="d"><span>{DAYS_ES[i]}</span><span className={`dot ${trained.has(d) ? "on" : ""} ${d === t ? "today" : ""}`}><Check /></span></div>)}</div>
      <div className="e-row between"><span className="e-muted">Adherencia semanal</span><b>{n} / {daysPerWeek} · {Math.round((n / daysPerWeek) * 100)} %</b></div>
    </div>
  );
}

function WeightTrend({ series }) {
  if (!series.length) return <span className="e-trend flat">sin datos</span>;
  const last = series[series.length - 1];
  const weekAgo = [...series].reverse().find((p) => p.date <= addDays(last.date, -7));
  const diff = weekAgo ? r1(last.ma - weekAgo.ma) : null;
  if (diff == null) return <span className="e-trend flat">media 7 d {fmtKg(last.ma)} kg</span>;
  const cls = diff < -0.05 ? "down" : diff > 0.05 ? "up" : "flat";
  const I = cls === "down" ? ArrowDown : cls === "up" ? ArrowUp : Minus;
  return <span className={`e-trend ${cls}`}><I />{diff > 0 ? "+" : ""}{fmtKg(diff)} kg / 7 d</span>;
}

function TodayScreen() {
  const store = useStore();
  const { data } = store;
  const nav = useNav();
  const integration = useIntegration();
  const exById = useExercisesById();
  const { foodsById, recipesById } = useFoodMaps();
  const active = useActiveSession();
  const planned = plannedDay(data);
  const t = todayISO();
  const { rec: diary, save: saveDiary } = useDiaryDay(t);
  const g = data.settings.goals;
  const totals = dayTotals(diary, foodsById, recipesById).total;
  const { series, scale } = useWeightSeries();
  const last = series[series.length - 1];
  const trainedToday = data.sessions.filter((s) => s.finishedAt && s.date === t);
  const start = () => {
    if (!planned) return;
    store.put("sessions", buildSession(planned.routine, planned.dayIndex, data));
    integration.onSessionStart();
    nav.go("entreno", "session");
  };
  const spark = series.slice(-30).map((p) => ({ d: p.date, kg: p.kg, ma: p.ma }));
  return (
    <div className="e-page">
      <div className="e-header">
        <div><h1>Hoy</h1><div className="sub" style={{ textTransform: "capitalize" }}>{fmtDate(t, true)}</div></div>
        <div className="e-row" style={{ gap: 6 }}>
          <Chip icon={integration.active ? Wifi : WifiOff} kind={integration.active ? "ok" : ""}>{integration.active ? "HA" : "local"}</Chip>
          <IconBtn icon={Settings} label="Ajustes" onClick={() => nav.go("ajustes")} />
        </div>
      </div>
      <Card accent={!!(active || (planned && !trainedToday.length))}>
        {active ? (
          <div className="e-row between"><div className="e-stack"><span className="e-label">Sesión en curso</span><b style={{ fontSize: 22 }}>{active.dayName}</b><span className="e-muted">{sessionSetCount(active)} series hechas</span></div><Btn variant="primary" icon={Play} onClick={() => nav.go("entreno", "session")}>Continuar</Btn></div>
        ) : trainedToday.length ? (
          <div className="e-row between"><div className="e-stack"><span className="e-label">Entrenamiento de hoy</span><b style={{ fontSize: 22 }}>{trainedToday.map((s) => s.dayName).join(" + ")}</b><span className="e-muted">{fmtN(sum(trainedToday.map((s) => sessionTonnage(s, exById))))} kg · {sum(trainedToday.map(sessionSetCount))} series · hecho</span></div><span className="e-chip ok" style={{ height: 34 }}><Check /> Hecho</span></div>
        ) : planned ? (
          <div className="e-row between"><div className="e-stack"><span className="e-label">Entrenamiento previsto</span><b style={{ fontSize: 22 }}>{planned.day.name}</b><span className="e-muted">{planned.routine.name} · {planned.day.blocks.length} ejercicios · {sum(planned.day.blocks.map((b) => b.sets))} series</span></div><Btn variant="primary" icon={Play} onClick={start}>Empezar</Btn></div>
        ) : <Empty icon={Dumbbell}>Crea una rutina en Entreno para ver aquí la sesión prevista.</Empty>}
      </Card>
      <div className="e-grid2">
        <Card title="Semana"><WeekDots sessions={data.sessions} daysPerWeek={data.settings.profile.daysPerWeek || 5} /></Card>
        <Card title="Peso corporal" action={<span className="e-muted">{last?.source === "ha" ? "báscula HA" : last ? "manual" : ""}</span>}>
          <div className="e-row between">
            <div className="e-stack">
              <div className="e-hero"><span className="e-big md">{last ? fmtKg(last.kg) : "–"}</span><span className="e-unit">kg</span></div>
              <WeightTrend series={series} />
            </div>
            {spark.length > 1 && (
              <div style={{ width: 140, height: 56 }}>
                <ResponsiveContainer>
                  <LineChart data={spark} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <YAxis hide domain={["dataMin - 0.3", "dataMax + 0.3"]} />
                    <Line type="monotone" dataKey="ma" stroke="var(--e-acc)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="kg" stroke="var(--e-text2)" strokeWidth={1} dot={false} strokeOpacity={0.6} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {scale.status === "error" && <Note kind="err" icon={AlertTriangle}>No se pudo leer {scale.entity}. Se usan los registros manuales.</Note>}
        </Card>
      </div>
      <Card title="Alimentación" action={<Btn size="xs" variant="soft" onClick={() => nav.go("comida", "diary")}>Diario</Btn>}>
        <div className="e-rings">
          <Ring value={totals.kcal} max={g.kcal} size={96} stroke={9}><b>{fmtN(Math.abs(g.kcal - totals.kcal))}</b><span>{g.kcal - totals.kcal >= 0 ? "kcal restan" : "kcal de más"}</span></Ring>
          <div className="e-grow e-col" style={{ gap: 8 }}>
            <MacroBar label="Proteína restante" value={totals.protein} max={g.protein} />
            <MacroBar label="Carbohidratos" value={totals.carbs} max={g.carbs} />
            <MacroBar label="Grasa" value={totals.fat} max={g.fat} />
          </div>
        </div>
        <div className="e-row between">
          <span className="e-row"><Droplets style={{ width: 16, color: "var(--e-acc)" }} /><b>{fmtN(diary.waterMl / 1000, 2)} l</b><span className="e-muted">de {fmtN(g.waterMl / 1000, 1)} l</span></span>
          <div className="e-row"><Btn size="xs" variant="soft" onClick={() => saveDiary({ waterMl: diary.waterMl + 250 })}>+250 ml</Btn><Btn size="xs" variant="soft" onClick={() => saveDiary({ waterMl: diary.waterMl + 500 })}>+500 ml</Btn></div>
        </div>
      </Card>
    </div>
  );
}

/* =============================================================================
 * AJUSTES
 * ========================================================================== */
function SettingsScreen() {
  const store = useStore();
  const { data } = store;
  const s = data.settings;
  const toast = useToast();
  const nav = useNav();
  const integration = useIntegration();
  const haRef = useHA([s.ha.scaleEntity]);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const inv = data.inventory;
  const setInv = (patch) => store.setInventory({ ...inv, ...patch });
  const setHa = (patch) => store.setSettings({ ha: { ...s.ha, ...patch } });
  const setHelper = (k, v) => setHa({ helpers: { ...s.ha.helpers, [k]: v } });
  const setGoal = (k, v) => store.setSettings({ goals: { ...s.goals, [k]: num(v) } });
  const setProfile = (k, v) => store.setSettings({ profile: { ...s.profile, [k]: v } });

  const barLoads = enumerateLoads(inv.plates, s.barbellKg, 2).map((l) => fmtKg(l.kg));
  const pairLoads = enumerateLoads(inv.plates, s.dumbbellBarKg, 4).map((l) => fmtKg(l.kg));

  const entityOpts = (domain, filter) => haRef.entities(domain).filter(filter || (() => true)).map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }));
  const scaleOpts = entityOpts("sensor", (e) => /kg|lb/i.test(e.attributes?.unit_of_measurement || "") || e.attributes?.device_class === "weight" || /peso|weight|scale|báscula|bascula/i.test(e.name + e.id));
  const notifyOpts = haRef.services("notify").filter((x) => x !== "notify.persistent_notification" && x !== "notify.send_message").map((x) => ({ value: x, label: x }));
  const ttsOpts = haRef.services("tts").filter((x) => !/clear_cache|reload/.test(x)).map((x) => ({ value: x, label: x }));
  const helperOpts = entityOpts("input_number");
  const noHa = !haRef.available;

  const doExport = async () => {
    const json = JSON.stringify(await store.exportJSON(), null, 2);
    setExportText(json);
    try { await navigator.clipboard.writeText(json); toast("Exportación copiada al portapapeles", "ok"); } catch { toast("Copia el texto del cuadro de abajo", "info"); }
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = `entreno-${todayISO()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { /* la descarga puede estar bloqueada en el visor */ }
  };
  const doImport = async (text) => {
    try {
      const payload = JSON.parse(text);
      if (!window.confirm("Esto sustituye TODOS los datos actuales por los del archivo. ¿Continuar?")) return;
      if (!payload || payload.app !== "entreno" || !payload.data) throw new Error("no es una exportación de Entreno");
      await store.replaceAll(payload.data);
      toast("Datos importados", "ok"); setImportText("");
    } catch (e) { toast(`No se pudo importar: ${e.message}`, "err"); }
  };
  const onFile = (e) => { const f = e.target.files?.[0]; if (!f) return; f.text().then(doImport); e.target.value = ""; };
  const resetSeed = async () => {
    if (!window.confirm("Se borrará todo y se cargarán los datos de ejemplo. ¿Continuar?")) return;
    await store.replaceAll(buildSeed()); toast("Datos de ejemplo restaurados", "ok");
  };
  const wipe = async () => {
    if (!window.confirm("Se borrarán todas las sesiones, el diario y el peso. Se conservan ejercicios, rutinas, alimentos, inventario y ajustes. ¿Continuar?")) return;
    await store.replaceAll({ settings: [s], inventory: [inv], exercises: data.exercises, routines: data.routines, foods: data.foods, recipes: data.recipes, sessions: [], diary: [], bodyweight: [], haQueue: [] });
    toast("Historial borrado", "ok");
  };

  return (
    <div className="e-page">
      <div className="e-header"><div className="e-row"><IconBtn icon={ChevronLeft} label="Volver" onClick={() => nav.go("hoy")} /><h1>Ajustes</h1></div><span className="e-muted">v{APP_VERSION}</span></div>

      <Card title="Perfil y objetivos">
        <div className="e-fields">
          <Field label="Altura (cm)"><Input type="number" inputMode="numeric" value={s.profile.heightCm} onChange={(e) => setProfile("heightCm", num(e.target.value))} /></Field>
          <Field label="Días de entreno / semana"><Input type="number" inputMode="numeric" value={s.profile.daysPerWeek} onChange={(e) => setProfile("daysPerWeek", clamp(num(e.target.value, 5), 1, 7))} /></Field>
          <Field label="Nivel"><Select value={s.profile.level} options={["principiante", "intermedio", "avanzado"]} onChange={(e) => setProfile("level", e.target.value)} /></Field>
          <Field label="Objetivo"><Select value={s.profile.goal} options={["Pérdida de grasa", "Mantenimiento", "Ganancia muscular"]} onChange={(e) => setProfile("goal", e.target.value)} /></Field>
        </div>
        <div className="e-fields">
          <Field label="Rutina activa"><Select value={s.activeRoutineId} options={data.routines.map((r) => ({ value: r.id, label: r.name }))} onChange={(e) => store.setSettings({ activeRoutineId: e.target.value })} /></Field>
          <Field label="Descanso por defecto (s)"><Input type="number" inputMode="numeric" value={s.restDefaultSec} onChange={(e) => store.setSettings({ restDefaultSec: clamp(num(e.target.value, 90), 15, 600) })} /></Field>
        </div>
        <div className="e-label">Objetivo diario</div>
        <div className="e-fields">
          <Field label="kcal"><Input type="number" inputMode="numeric" value={s.goals.kcal} onChange={(e) => setGoal("kcal", e.target.value)} /></Field>
          <Field label="Proteína (g)"><Input type="number" inputMode="numeric" value={s.goals.protein} onChange={(e) => setGoal("protein", e.target.value)} /></Field>
          <Field label="Carbohidratos (g)"><Input type="number" inputMode="numeric" value={s.goals.carbs} onChange={(e) => setGoal("carbs", e.target.value)} /></Field>
          <Field label="Grasa (g)"><Input type="number" inputMode="numeric" value={s.goals.fat} onChange={(e) => setGoal("fat", e.target.value)} /></Field>
          <Field label="Agua (ml)"><Input type="number" inputMode="numeric" value={s.goals.waterMl} onChange={(e) => setGoal("waterMl", e.target.value)} /></Field>
        </div>
        <p className="e-muted">Macros: {fmtN(s.goals.protein * 4 + s.goals.carbs * 4 + s.goals.fat * 9)} kcal calculadas frente a {fmtN(s.goals.kcal)} de objetivo.</p>
      </Card>

      <Card title="Material">
        <div className="e-fields">
          <Field label="Peso de la barra olímpica (kg)"><Input type="number" inputMode="decimal" step="0.5" value={s.barbellKg} onChange={(e) => store.setSettings({ barbellKg: num(e.target.value, 20) })} /></Field>
          <Field label="Peso de cada barra de mancuerna (kg)"><Input type="number" inputMode="decimal" step="0.5" value={s.dumbbellBarKg} onChange={(e) => store.setSettings({ dumbbellBarKg: num(e.target.value, 2) })} /></Field>
        </div>
        <div className="e-label">Discos</div>
        <table className="e-table"><thead><tr><th>Peso (kg)</th><th className="r">Unidades</th><th className="r">Total</th><th /></tr></thead><tbody>
          {inv.plates.map((p, i) => (
            <tr key={i}>
              <td><Input type="number" inputMode="decimal" step="0.25" value={p.kg} style={{ width: 90, minHeight: 38 }} onChange={(e) => setInv({ plates: inv.plates.map((x, j) => (j === i ? { ...x, kg: num(e.target.value) } : x)) })} aria-label="Peso del disco" /></td>
              <td className="r"><Input type="number" inputMode="numeric" value={p.count} style={{ width: 70, minHeight: 38, marginLeft: "auto" }} onChange={(e) => setInv({ plates: inv.plates.map((x, j) => (j === i ? { ...x, count: clamp(num(e.target.value), 0, 40) } : x)) })} aria-label="Número de discos" /></td>
              <td className="r">{fmtKg(p.kg * p.count)} kg</td>
              <td className="r"><IconBtn small icon={Trash2} label="Quitar" onClick={() => setInv({ plates: inv.plates.filter((_, j) => j !== i) })} /></td>
            </tr>
          ))}
          <tr><td colSpan={2}><Btn size="xs" variant="soft" icon={Plus} onClick={() => setInv({ plates: [...inv.plates, { kg: 2.5, count: 2 }].sort((a, b) => b.kg - a.kg) })}>Añadir disco</Btn></td><td className="r"><b>{fmtKg(sum(inv.plates.map((p) => p.kg * p.count)))} kg</b></td><td /></tr>
        </tbody></table>
        <div className="e-fields">
          <Field label="Kettlebells (kg, separadas por comas)"><Input value={inv.kettlebells.map((k) => fmtKg(k.kg)).join(", ")} onChange={(e) => setInv({ kettlebells: e.target.value.split(",").map((x) => num(x)).filter((x) => x > 0).map((kg) => ({ kg, count: 1 })) })} /></Field>
        </div>
        <Toggle label="Banco con respaldo inclinable" on={inv.bench.incline} onChange={(v) => setInv({ bench: { ...inv.bench, incline: v } })} />
        <Toggle label="Banco con posición declinada" on={inv.bench.decline} onChange={(v) => setInv({ bench: { ...inv.bench, decline: v } })} />
        <div className="e-note"><Info /><span><b>Barra:</b> {barLoads.join(" · ")} kg<br /><b>Par de mancuernas:</b> {pairLoads.join(" · ")} kg por mancuerna<br />Incremento mínimo real: {fmtKg(2 * Math.min(...inv.plates.map((p) => p.kg)))} kg.</span></div>
      </Card>

      <Card title="Home Assistant">
        <div className="e-row"><span className={`e-status-dot ${haRef.available ? "on" : ""}`} /><span>{haRef.available ? `Conectado · ${Object.keys(haRef.hass.states).length} entidades` : "Sin conexión: la app se ejecuta fuera de Home Assistant"}</span></div>
        {noHa && <Note>Los selectores se rellenan con tus entidades reales cuando el panel corre dentro de Home Assistant. La configuración se guarda igualmente.</Note>}
        <Toggle id="ha-enabled" label="Integración activada" hint="Publicar métricas, eventos y avisos" on={s.ha.enabled} onChange={(v) => setHa({ enabled: v })} />
        <div className="e-label">Lecturas</div>
        <Field label="Báscula (sensor de peso)" hint="Origen de la gráfica de peso; el registro manual cubre los días sin lectura."><Select value={s.ha.scaleEntity} disabled={noHa} placeholder={noHa ? s.ha.scaleEntity || "— sin conexión —" : "— ninguna —"} options={scaleOpts.length ? scaleOpts : entityOpts("sensor")} onChange={(e) => setHa({ scaleEntity: e.target.value })} /></Field>
        <div className="e-label">Publicación</div>
        <div className="e-fields">
          <Field label="Calendario (días entrenados)"><Select value={s.ha.calendarEntity} disabled={noHa} placeholder={noHa ? s.ha.calendarEntity || "— sin conexión —" : "— ninguno —"} options={entityOpts("calendar")} onChange={(e) => setHa({ calendarEntity: e.target.value })} /></Field>
          <Field label="Lista de tareas (compra)"><Select value={s.ha.todoEntity} disabled={noHa} placeholder={noHa ? s.ha.todoEntity || "— sin conexión —" : "— ninguna —"} options={entityOpts("todo")} onChange={(e) => setHa({ todoEntity: e.target.value })} /></Field>
          <Field label="Escena al iniciar sesión"><Select value={s.ha.sceneStart} disabled={noHa} placeholder={noHa ? s.ha.sceneStart || "— sin conexión —" : "— ninguna —"} options={entityOpts("scene")} onChange={(e) => setHa({ sceneStart: e.target.value })} /></Field>
          <Field label="Escena al cerrar sesión"><Select value={s.ha.sceneEnd} disabled={noHa} placeholder={noHa ? s.ha.sceneEnd || "— sin conexión —" : "— ninguna —"} options={entityOpts("scene")} onChange={(e) => setHa({ sceneEnd: e.target.value })} /></Field>
        </div>
        <div className="e-label">Helpers input_number</div>
        <div className="e-fields">
          {[["weeklyVolume", "Volumen semanal (series)"], ["weeklySessions", "Sesiones de la semana"], ["adherence", "Adherencia (%)"], ["dayTonnage", "Tonelaje del día (kg)"], ["proteinLeft", "Proteína restante (g)"]].map(([k, label]) => (
            <Field key={k} label={label}><Select value={s.ha.helpers[k]} disabled={noHa} placeholder={noHa ? s.ha.helpers[k] || "— sin conexión —" : "— ninguno —"} options={helperOpts} onChange={(e) => setHelper(k, e.target.value)} /></Field>
          ))}
        </div>
        <div className="e-label">Temporizador de descanso</div>
        <Toggle id="ha-rest" label="Avisar por Home Assistant al terminar el descanso" on={s.ha.notifyOnRest} onChange={(v) => setHa({ notifyOnRest: v })} />
        <div className="e-fields">
          <Field label="Servicio de notificación"><Select value={s.ha.notifyService} disabled={noHa} placeholder={noHa ? s.ha.notifyService || "— sin conexión —" : "— ninguno —"} options={notifyOpts} onChange={(e) => setHa({ notifyService: e.target.value })} /></Field>
          <Field label="Servicio TTS"><Select value={s.ha.ttsService} disabled={noHa} placeholder={noHa ? s.ha.ttsService || "— sin conexión —" : "— ninguno —"} options={ttsOpts} onChange={(e) => setHa({ ttsService: e.target.value })} /></Field>
          {s.ha.ttsService.endsWith(".speak") && <Field label="Entidad TTS"><Select value={s.ha.ttsEntity} disabled={noHa} placeholder="— ninguna —" options={entityOpts("tts")} onChange={(e) => setHa({ ttsEntity: e.target.value })} /></Field>}
          {s.ha.ttsService && <Field label="Reproductor"><Select value={s.ha.mediaPlayerEntity} disabled={noHa} placeholder="— ninguno —" options={entityOpts("media_player")} onChange={(e) => setHa({ mediaPlayerEntity: e.target.value })} /></Field>}
        </div>
        <div className="e-label">Envíos pendientes</div>
        {data.haQueue.length ? (<>
          <div className="e-list">{data.haQueue.map((j) => <div key={j.id} className="e-item" style={{ padding: "8px 0", minHeight: 40 }}><span className="e-grow e-stack"><span className="t">{j.label} · {j.domain}.{j.service}</span><span className="s">{j.entity || ""} · {j.attempts} intento{j.attempts > 1 ? "s" : ""} · {j.lastError}</span></span><IconBtn small icon={Trash2} label="Descartar" onClick={() => store.remove("haQueue", j.id)} /></div>)}</div>
          <div className="e-row"><Btn size="sm" variant="soft" icon={RefreshCw} disabled={!haRef.available} onClick={integration.flushQueue}>Reintentar ahora</Btn><Btn size="sm" variant="outline" onClick={() => data.haQueue.forEach((j) => store.remove("haQueue", j.id))}>Vaciar cola</Btn></div>
        </>) : <p className="e-muted">Ninguno. Los envíos que fallen se guardan aquí y se reintentan solos.</p>}
      </Card>

      <Card title="Datos">
        <p className="e-muted">Todo vive en IndexedDB de este navegador{db.usesMemory ? " (no disponible: los datos se pierden al recargar)" : ""}. Exporta con regularidad.</p>
        <div className="e-row wrap">
          <Btn variant="soft" icon={Download} onClick={doExport}>Exportar JSON</Btn>
          <label className="e-btn outline" style={{ cursor: "pointer" }}><Upload /> Importar archivo<input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onFile} /></label>
        </div>
        {exportText && <textarea className="e-textarea" readOnly value={exportText} onFocus={(e) => e.target.select()} aria-label="Exportación" />}
        <Field label="Importar pegando JSON"><textarea className="e-textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"app":"entreno", …}' /></Field>
        {importText && <Btn variant="primary" icon={Upload} onClick={() => doImport(importText)}>Importar texto</Btn>}
        <div className="e-row wrap"><Btn variant="outline" icon={RefreshCw} onClick={resetSeed}>Restaurar ejemplos</Btn><Btn variant="danger" icon={Trash2} onClick={wipe}>Borrar historial</Btn></div>
      </Card>

      <Card title="Acerca de">
        <p className="e-muted">Entreno v{APP_VERSION}. Un solo usuario, sin backend. Fase 1: aplicación autónoma. Fase 2: panel personalizado de Home Assistant con este mismo código; la capa de integración ya está construida y se activa sola cuando el panel recibe <span className="e-kbd">hass</span>.</p>
      </Card>
    </div>
  );
}

/* =============================================================================
 * PROGRESO
 * ========================================================================== */
// Seis grupos con orden fijo de color (paleta validada para visión del color en fondo oscuro).
const VOL_GROUPS = [
  { key: "pecho", label: "Pecho", color: "#4F8CFF", muscles: ["pecho"] },
  { key: "espalda", label: "Espalda", color: "#C9731F", muscles: ["espalda"] },
  { key: "hombro", label: "Hombro", color: "#1F9E8B", muscles: ["hombro"] },
  { key: "brazos", label: "Brazos", color: "#8A5FE6", muscles: ["bíceps", "tríceps"] },
  { key: "pierna", label: "Pierna", color: "#D4406A", muscles: ["cuádriceps", "isquios", "glúteo", "gemelo"] },
  { key: "core", label: "Core", color: "#879A1F", muscles: ["core"] },
];

function ProgressScreen() {
  const store = useStore();
  const { data } = store;
  const toast = useToast();
  const exById = useExercisesById();
  const { series, scale } = useWeightSeries();
  const [addW, setAddW] = useState(false);
  const [wDate, setWDate] = useState(todayISO());
  const [wKg, setWKg] = useState("");
  const [range, setRange] = useState(90);
  const t = todayISO();

  const wSeries = series.filter((p) => p.date >= addDays(t, -range)).map((p) => ({ ...p, d: fmtDateShort(p.date) }));
  const last = series[series.length - 1];
  const first30 = [...series].reverse().find((p) => p.date <= addDays(t, -30));

  const weeks = Array.from({ length: 8 }, (_, i) => { const ws = addDays(weekStart(t), -7 * (7 - i)); return { ws, we: addDays(ws, 6) }; });
  const volData = weeks.map(({ ws, we }) => {
    const v = volumeByMuscle(data.sessions, exById, ws, we);
    const row = { w: fmtDateShort(ws), ws };
    for (const g of VOL_GROUPS) row[g.key] = r1(sum(g.muscles.map((m) => v[m])));
    return row;
  });
  const thisWeek = volumeByMuscle(data.sessions, exById, weekStart(t), addDays(weekStart(t), 6));

  const withHistory = data.exercises.filter((e) => e1rmHistory(data.sessions, e.id).length > 0 && LOAD_MODES[e.loadMode].implement);
  const [exId, setExId] = useState("");
  const chosen = withHistory.find((e) => e.id === exId) || withHistory[0];
  const hist = chosen ? e1rmHistory(data.sessions, chosen.id).map((h) => ({ ...h, d: fmtDateShort(h.date) })) : [];
  const prs = data.sessions.filter((s) => s.finishedAt).flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => x.pr).map((x) => ({ date: s.date, name: exById[e.exerciseId]?.name, kg: x.kg, reps: x.reps })))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);

  const saveWeight = () => {
    const kg = num(wKg);
    if (kg < 30 || kg > 300) { toast("Introduce un peso válido", "warn"); return; }
    store.put("bodyweight", { date: wDate, kg: r1(kg), source: "manual" });
    setAddW(false); setWKg(""); toast("Peso registrado", "ok");
  };

  return (
    <div className="e-page wide">
      <div className="e-header"><h1>Progreso</h1></div>
      <div className="e-grid2">
        <Card title="Peso corporal" action={<Btn size="xs" variant="soft" icon={Plus} onClick={() => setAddW(true)}>Registrar</Btn>}>
          <div className="e-row" style={{ gap: 24, alignItems: "flex-end" }}>
            <div className="e-stack"><span className="e-label">Actual</span><div className="e-hero"><span className="e-big md">{last ? fmtKg(last.kg) : "–"}</span><span className="e-unit">kg</span></div></div>
            <div className="e-stack"><span className="e-label">Media 7 d</span><b style={{ fontSize: 22 }}>{last ? fmtKg(last.ma) : "–"}</b></div>
            <div className="e-stack"><span className="e-label">30 días</span><b style={{ fontSize: 22, color: first30 && last.ma - first30.ma < 0 ? "var(--e-ok)" : "inherit" }}>{first30 && last ? `${last.ma - first30.ma > 0 ? "+" : ""}${fmtKg(last.ma - first30.ma)}` : "–"}</b></div>
          </div>
          <Segmented options={[{ value: 30, label: "30 d" }, { value: 90, label: "90 d" }, { value: 365, label: "1 año" }]} value={range} onChange={setRange} />
          <div className="e-chart tall">
            {wSeries.length > 1 ? (
              <ResponsiveContainer>
                <LineChart data={wSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--e-div)" vertical={false} />
                  <XAxis dataKey="d" {...CHART_AXIS} minTickGap={28} />
                  <YAxis {...CHART_AXIS} domain={["auto", "auto"]} width={40} tickFormatter={(v) => fmtKg(v)} />
                  <Tooltip content={<ChartTip fmt={(v) => `${fmtKg(v)} kg`} />} />
                  <Line type="monotone" dataKey="kg" name="Peso" stroke="var(--e-text2)" strokeWidth={1} dot={{ r: 2.5, fill: "var(--e-text2)", strokeWidth: 0 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="ma" name="Media 7 días" stroke="var(--e-acc)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty icon={Scale}>Registra tu peso para ver la evolución.</Empty>}
          </div>
          <div className="e-row between"><span className="e-row e-muted"><span style={{ width: 14, height: 3, background: "var(--e-acc)", borderRadius: 2 }} /> media 7 días <span style={{ width: 14, height: 1, background: "var(--e-text2)", marginLeft: 8 }} /> lecturas</span><span className="e-muted">{scale.entity && data.settings.ha.enabled ? (scale.status === "ok" ? `báscula: ${scale.entity}` : scale.status === "loading" ? "leyendo báscula…" : "báscula no disponible") : "registro manual"}</span></div>
        </Card>

        <Card title="Volumen semanal · series efectivas">
          <div className="e-chart tall">
            <ResponsiveContainer>
              <BarChart data={volData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid stroke="var(--e-div)" vertical={false} />
                <XAxis dataKey="w" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} allowDecimals={false} width={32} />
                <Tooltip cursor={{ fill: "var(--e-card2)" }} content={<ChartTip fmt={(v) => `${fmtN(v, 1)} series`} />} />
                {VOL_GROUPS.map((g, i) => <Bar key={g.key} dataKey={g.key} name={g.label} stackId="v" fill={g.color} stroke="var(--e-card)" strokeWidth={1} radius={i === VOL_GROUPS.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="e-chips">{VOL_GROUPS.map((g) => <span key={g.key} className="e-chip"><span style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} />{g.label}</span>)}</div>
          <table className="e-table"><thead><tr><th>Esta semana</th><th className="r">Series</th><th className="r">Objetivo 10–20</th></tr></thead><tbody>
            {MUSCLES.map((m) => { const v = thisWeek[m]; const st = v >= 10 && v <= 20 ? "ok" : v > 20 ? "warn" : ""; return <tr key={m}><td style={{ textTransform: "capitalize" }}>{m}</td><td className="r"><b>{fmtN(v, 1)}</b></td><td className="r"><div className="e-bar" style={{ width: 90, marginLeft: "auto" }}><i className={v > 20 ? "over" : ""} style={{ width: `${clamp((v / 20) * 100, 0, 100)}%`, background: st === "ok" ? "var(--e-ok)" : undefined }} /></div></td></tr>; })}
          </tbody></table>
        </Card>

        <Card title="1RM estimado (Epley)">
          {withHistory.length ? (<>
            <Select value={chosen?.id} options={withHistory.map((e) => ({ value: e.id, label: e.name }))} onChange={(e) => setExId(e.target.value)} aria-label="Ejercicio" />
            <div className="e-row" style={{ gap: 24 }}>
              <div className="e-stack"><span className="e-label">Mejor</span><b style={{ fontSize: 22 }}>{fmtKg(Math.max(...hist.map((h) => h.e1rm)))} kg</b></div>
              <div className="e-stack"><span className="e-label">Último</span><b style={{ fontSize: 22 }}>{fmtKg(hist[hist.length - 1].e1rm)} kg</b></div>
              <div className="e-stack"><span className="e-label">Sesiones</span><b style={{ fontSize: 22 }}>{hist.length}</b></div>
            </div>
            <div className="e-chart">
              <ResponsiveContainer>
                <LineChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--e-div)" vertical={false} />
                  <XAxis dataKey="d" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} domain={["auto", "auto"]} width={40} tickFormatter={(v) => fmtKg(v)} />
                  <Tooltip content={<ChartTip fmt={(v, k) => `${fmtKg(v)} kg`} />} />
                  <Line type="monotone" dataKey="e1rm" name="1RM estimado" stroke="var(--e-acc)" strokeWidth={2} dot={{ r: 3, fill: "var(--e-acc)", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>) : <Empty icon={TrendingUp}>Cierra alguna sesión con carga para ver la evolución del 1RM.</Empty>}
        </Card>

        <Card title="Récords recientes" flush>
          <div className="e-list" style={{ marginTop: 8 }}>
            {prs.map((p, i) => <div key={i} className="e-item" style={{ minHeight: 48 }}><Trophy style={{ width: 18, color: "var(--e-warn)" }} /><span className="e-grow e-stack"><span className="t">{p.name}</span><span className="s">{fmtDate(p.date, true)}</span></span><span className="v">{num(p.kg) > 0 ? `${fmtKg(p.kg)} kg × ${p.reps}` : `${p.reps} reps`}</span></div>)}
            {!prs.length && <Empty icon={Trophy}>Los récords aparecen aquí al superar tu mejor 1RM estimado.</Empty>}
          </div>
        </Card>
      </div>
      <Sheet open={addW} onClose={() => setAddW(false)} title="Registrar peso" footer={<Btn variant="primary" full icon={Check} onClick={saveWeight}>Guardar</Btn>}>
        <div className="e-fields">
          <Field label="Fecha"><Input type="date" value={wDate} max={t} onChange={(e) => setWDate(e.target.value)} /></Field>
          <Field label="Peso (kg)"><Input id="w-kg" type="number" inputMode="decimal" step="0.1" value={wKg} placeholder={last ? fmtKg(last.kg) : "116,0"} onChange={(e) => setWKg(e.target.value)} autoFocus /></Field>
        </div>
        {data.settings.ha.enabled && data.settings.ha.scaleEntity && <Note>La báscula de Home Assistant tiene prioridad: este registro solo se usa en días sin lectura.</Note>}
      </Sheet>
    </div>
  );
}

/* =============================================================================
 * ARMAZÓN DE LA APP
 * ========================================================================== */
const TABS = [
  { id: "hoy", label: "Hoy", icon: Home },
  { id: "entreno", label: "Entreno", icon: Dumbbell },
  { id: "comida", label: "Comida", icon: Utensils },
  { id: "progreso", label: "Progreso", icon: TrendingUp },
];

function App() {
  const [nav, setNav] = useState({ tab: "hoy", view: null, params: null });
  const mainRef = useRef(null);
  const go = useCallback((tab, view = null, params = null) => setNav({ tab, view, params }), []);
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }); }, [nav.tab, nav.view]);
  const { data } = useStore();
  // Entidades que la app observa en hass para re-renderizar solo cuando cambian.
  const watch = useMemo(() => [data.settings.ha.scaleEntity, ...Object.values(data.settings.ha.helpers)], [data.settings.ha]);
  useHA(watch);
  const active = data.sessions.find((s) => !s.finishedAt);
  return (
    <NavCtx.Provider value={{ ...nav, go }}>
      <div className="e-app">
        <main className="e-main" ref={mainRef}>
          {nav.tab === "hoy" && <TodayScreen />}
          {nav.tab === "entreno" && <TrainScreen />}
          {nav.tab === "comida" && <FoodScreen />}
          {nav.tab === "progreso" && <ProgressScreen />}
          {nav.tab === "ajustes" && <SettingsScreen />}
        </main>
        <nav className="e-nav" aria-label="Secciones">
          <div className="e-nav-inner">
            {TABS.map((t) => { const I = t.icon; return (
              <button key={t.id} className={nav.tab === t.id ? "on" : ""} onClick={() => go(t.id)} aria-current={nav.tab === t.id ? "page" : undefined}>
                <span style={{ position: "relative" }}><I />{t.id === "entreno" && active && <span style={{ position: "absolute", top: -2, right: -4, width: 8, height: 8, borderRadius: "50%", background: "var(--e-ok)" }} />}</span>
                {t.label}
              </button>
            ); })}
          </div>
        </nav>
      </div>
    </NavCtx.Provider>
  );
}

function Root() {
  return <ToastProvider><StoreProvider><App /></StoreProvider></ToastProvider>;
}

/* =============================================================================
 * ELEMENTO <entreno-panel>
 * Home Assistant asigna hass, narrow, route y panel. Fuera de HA, hass es nulo.
 * ========================================================================== */
class EntrenoPanel extends HTMLElement {
  set hass(v) { this._hass = v; ha.setHass(v || null); }
  get hass() { return this._hass; }
  set narrow(v) { this._narrow = v; ha.narrow = !!v; }
  get narrow() { return this._narrow; }
  set route(v) { this._route = v; }
  get route() { return this._route; }
  set panel(v) { this._panel = v; }
  get panel() { return this._panel; }
  connectedCallback() {
    injectStyles();
    if (!document.querySelector("home-assistant")) this.classList.add("e-standalone");
    if (!this._root) { this._root = createRoot(this); this._root.render(<Root />); }
  }
  disconnectedCallback() {
    if (this._root) { const r = this._root; this._root = null; setTimeout(() => r.unmount()); }
  }
}
if (typeof customElements !== "undefined" && !customElements.get("entreno-panel")) customElements.define("entreno-panel", EntrenoPanel);

export { EntrenoPanel, loadsFor, enumerateLoads, validateLoad, suggestProgression, epley };
