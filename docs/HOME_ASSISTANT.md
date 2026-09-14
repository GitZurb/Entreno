# Entreno como panel personalizado de Home Assistant

## 1. Construir el módulo

```bash
npm install
npm run build
```

Genera `dist/panel.js`: un único módulo ES autocontenido (React, recharts y
lucide-react incluidos, sin CDN en tiempo de ejecución). `build.mjs` es el fichero de
configuración del empaquetador (esbuild); no hay más ficheros de configuración.

Tamaño: 821 kB sin comprimir, 240 kB con gzip. Reparto: recharts y sus dependencias
44 %, react-dom 25 %, código propio 24 %. Se sirve una vez y queda en caché.

## 2. Instalar en Home Assistant

1. Copia `dist/panel.js` a `config/www/entrenador/panel.js`
   (crea la carpeta si no existe; `config/www` se sirve como `/local/`).
2. Añade a `configuration.yaml` el contenido de `docs/ha/configuration.yaml`.
3. Crea los helpers: copia `docs/ha/input_number.yaml` a `config/input_number.yaml`
   (o créalos a mano en Ajustes → Ayudantes con esos mismos nombres, unidades,
   mínimos, máximos y pasos).
4. Comprueba la configuración (Ajustes → Sistema → Reiniciar → Comprobar configuración).
5. **Reinicia Home Assistant.** `panel_custom` no admite recarga en caliente; solo se
   registra al arrancar.
6. Abre «Entreno» en la barra lateral. Ve a Ajustes (engranaje en la pantalla Hoy) →
   Home Assistant: activa la integración y elige báscula, pasos, calendario, lista de
   tareas, escenas, helpers y servicios de aviso. Los selectores muestran solo entidades
   reales, filtradas por dominio.

## 3. Actualizar el panel

1. `npm run build` y copia de nuevo `dist/panel.js` a `config/www/entrenador/`.
2. Cambia el parámetro de versión en `module_url` (`?v=0.2.1`) y reinicia HA.
   Los ficheros de `config/www` se sirven con caché agresiva: sin cambiar la URL el
   navegador (y la app móvil) seguirán usando la versión antigua.
3. Si el navegador aún muestra la versión anterior, recarga con Ctrl+F5 o borra la
   caché del sitio en la app de HA (Ajustes → Compañero → Depuración → Borrar caché).

## 4. Recargas necesarias

| Cambio | Recarga |
|---|---|
| `panel_custom` (alta o cambio de `module_url`) | Reinicio completo de Home Assistant |
| `input_number.yaml` | Herramientas para desarrolladores → YAML → Input numbers |
| `panel.js` sin cambiar `?v=` | No sirve: hay que cambiar la versión de la URL |

## 5. Helpers que rellena la app

| Entidad | Unidad | Mín | Máx | Paso | Cuándo |
|---|---|---|---|---|---|
| `input_number.entreno_volumen_semanal` | series | 0 | 300 | 0,5 | al cerrar sesión |
| `input_number.entreno_sesiones_semana` | sesiones | 0 | 14 | 1 | al cerrar sesión |
| `input_number.entreno_adherencia` | % | 0 | 200 | 1 | al cerrar sesión |
| `input_number.entreno_tonelaje_dia` | kg | 0 | 50000 | 1 | al cerrar sesión |
| `input_number.entreno_proteina_restante` | g | 0 | 400 | 1 | al cambiar el diario de hoy |

Además: `calendar.create_event` en el calendario elegido al cerrar sesión,
`todo.add_item` al enviar la lista de la compra, `scene.turn_on` al iniciar y cerrar,
y el servicio de notificación o TTS elegido al terminar el descanso.

## 6. Cómo funciona la integración

- Home Assistant asigna al elemento `<entreno-panel>` las propiedades `hass`,
  `narrow`, `route` y `panel`. El setter de `hass` solo re-renderiza cuando cambian las
  entidades configuradas, no en cada actualización de estado de la casa.
- Lecturas en tiempo real desde `hass.states`; sin polling.
- Servicios con `hass.callService`. Toda llamada va envuelta en control de errores:
  si falla o la entidad no existe, la app avisa nombrando la entidad, sigue en local y
  encola el envío (persistente en IndexedDB) para reintentarlo cada 60 s y al reconectar.
- Histórico de la báscula por WebSocket `history/history_during_period` (formato
  comprimido `{s, lu}`) y, si tu versión no lo admite, `hass.callApi('GET',
  'history/period/...')`. Ambas rutas están en `ha.history()` dentro de `src/App.jsx`.
- La hoja de estilos se inserta dentro del propio elemento, así que funciona aunque HA
  monte el panel en un shadow root. Los colores se leen de las variables del tema
  activo de HA (`--primary-background-color`, `--card-background-color`,
  `--primary-text-color`, `--secondary-text-color`, `--divider-color`,
  `--primary-color`/`--accent-color`) con respaldo oscuro propio fuera de HA.
- En pantallas estrechas (`narrow`) el panel muestra una barra superior con el botón
  de menú que abre la barra lateral de HA (evento `hass-toggle-menu`).
- Sin `hass` (por ejemplo abriendo `dist/index.html`) la integración queda inactiva y
  la app es plenamente usable en local.

## 7. Ejemplos de uso en HA

Tarjeta de entidades en un dashboard:

```yaml
type: entities
title: Entreno
entities:
  - input_number.entreno_sesiones_semana
  - input_number.entreno_adherencia
  - input_number.entreno_volumen_semanal
  - input_number.entreno_tonelaje_dia
  - input_number.entreno_proteina_restante
```

Aviso de proteína a las 20:00 (la app solo publica el dato; la automatización es tuya):

```yaml
alias: Recordatorio de proteína
trigger:
  - platform: time
    at: "20:00:00"
condition:
  - condition: numeric_state
    entity_id: input_number.entreno_proteina_restante
    above: 40
action:
  - service: notify.mobile_app_tu_movil
    data:
      message: "Te quedan {{ states('input_number.entreno_proteina_restante') | int }} g de proteína hoy."
```
