# Entreno en Home Assistant

## Estado de esta instalación

Ya está hecho en la instancia (Home Assistant 2026.9.2, vía MCP):

| Elemento | Valor |
|---|---|
| Panel en la barra lateral | **Entreno** (`/entreno-app`), vista en modo panel con la tarjeta `custom:entreno-panel` |
| Recurso de Lovelace | `/local/entrenador/panel.js?v=0.2.1` (módulo) |
| Helper volumen semanal | `input_number.entreno_volumen_semanal` · series · 0–300 · paso 0,5 |
| Helper sesiones de la semana | `input_number.entreno_sesiones_semana` · sesiones · 0–14 · paso 1 |
| Helper adherencia | `input_number.entreno_adherencia` · % · 0–200 · paso 1 |
| Helper tonelaje del día | `input_number.entreno_tonelaje_dia` · kg · 0–50000 · paso 1 |
| Helper proteína restante | `input_number.entreno_proteina_restante` · g · 0–400 · paso 1 |
| Báscula | `sensor.withings_peso` |
| Lista de la compra | `todo.lista_de_la_compra` |
| Aviso de descanso | `notify.mobile_app_movil` |

Falta **un paso manual**, el único que no se puede hacer por MCP porque Home
Assistant no expone escritura de ficheros:

1. Copia `dist/panel.js` a `config/www/entrenador/panel.js` (crea la carpeta si
   no existe; `config/www` se sirve como `/local/`). Vale cualquier vía: File
   editor, Samba, SSH, o el navegador de archivos de tu editor.
2. Recarga la página de Home Assistant. Ya está: no hay que editar
   `configuration.yaml` ni reiniciar.

Hasta que el fichero exista, el panel muestra «Custom element doesn't exist:
entreno-panel». Es lo esperado.

No configurado por no haber entidades de ese tipo en la instancia:

- **Calendario de días entrenados**: no hay ninguna entidad `calendar`. Si
  añades una (Calendario local, Google), selecciónala en Ajustes → Home Assistant.
- **Pasos diarios**: no hay sensor de pasos. La app companion del móvil puede
  exponerlo (Ajustes → Companion → Sensores → Pasos); luego se elige en Ajustes.
- **Escenas de inicio y cierre**: tienes escenas de Hue disponibles, pero la
  elección es tuya; se configuran dentro de la app.

## Construir

```bash
npm install
npm run build
```

`build.mjs` es el fichero de configuración del empaquetador (esbuild). Produce:

| Salida | Para qué |
|---|---|
| `dist/panel.js` | módulo ES autocontenido: el que va en `config/www/entrenador/` |
| `dist/index.html` | página autónoma (desarrollo y artifact) |
| `dist/resource.js` | el mismo módulo comprimido y autoextraíble, por si algún día interesa registrarlo como recurso en línea sin acceso a ficheros |

Sin dependencias de CDN en tiempo de ejecución.

### Peso del módulo

223 kB (65 kB con gzip), frente a los 817 kB de la primera versión. Dos
decisiones explícitas:

- **recharts fuera.** Las cuatro gráficas (peso con media móvil, volumen
  semanal apilado, 1RM estimado y minigráfica) se dibujan con SVG propio:
  escala con marcas redondas, rejilla discreta, detalle al pasar el dedo y
  línea de referencia del hito. recharts y sus dependencias pesaban 380 kB,
  el 46 % del bundle, para eso.
- **Preact en lugar de React**, a través de `preact/compat`, que es un alias en
  el empaquetador y no cambia ni una línea del código de la aplicación. 200 kB
  menos.

## Actualizar el panel

1. `npm run build`.
2. Copia `dist/panel.js` a `config/www/entrenador/panel.js`.
3. Cambia la versión de la URL del recurso (`?v=0.2.1`) desde Ajustes →
   Dashboards → Recursos, o dímelo y lo cambio por MCP.

Los ficheros de `config/www` se sirven con **caché agresiva**: sin cambiar el
parámetro de versión, el navegador y la app móvil seguirán usando el módulo
antiguo.

## Recargas necesarias

| Cambio | Recarga |
|---|---|
| Recurso de Lovelace (alta o cambio de versión) | recargar la página |
| Helpers creados por interfaz o MCP | ninguna |
| Nuevo `panel.js` sin cambiar `?v=` | no sirve: hay que cambiar la versión |
| `panel_custom` en `configuration.yaml` (alternativa de abajo) | reinicio completo |

## Alternativa: panel_custom en configuration.yaml

La instalación de arriba (recurso + dashboard) no toca YAML y no necesita
reinicio, así que es la recomendada. Si prefieres el registro clásico como
panel, en `docs/ha/configuration.yaml` está el fragmento con `panel_custom`
(`name: entreno-panel`, `module_url: /local/entrenador/panel.js?v=0.2.1`,
`embed_iframe: false`) y en `docs/ha/input_number.yaml` los mismos helpers en
YAML. Esa vía sí exige reiniciar Home Assistant.

## Cómo funciona la integración

- El elemento `<entreno-panel>` implementa los setters `hass`, `narrow`,
  `route` y `panel` de `panel_custom`, y además `setConfig`, que es lo que lo
  hace utilizable como tarjeta de dashboard. La configuración de la tarjeta
  (entidades y helpers) se aplica una sola vez, en el primer arranque; a partir
  de ahí manda la pantalla de Ajustes de la app.
- El setter de `hass` solo provoca redibujado cuando cambia alguna de las
  entidades configuradas, no en cada actualización de estado de la casa.
- Lecturas en tiempo real desde `hass.states`, sin polling.
- Servicios con `hass.callService`, siempre con control de errores: si falla o
  la entidad no existe, la app avisa nombrando la entidad, sigue funcionando en
  local y encola el envío (persistente en IndexedDB) para reintentarlo cada
  60 s y al reconectar.
- Histórico de la báscula por WebSocket `history/history_during_period`
  (respuesta comprimida `{s, lu}`) con alternativa REST
  `hass.callApi('GET', 'history/period/...')` documentada en `ha.history()`.
- La hoja de estilos se inserta dentro del propio elemento, así que funciona
  aunque Home Assistant lo monte en un shadow root. Los colores se leen de las
  variables del tema activo con respaldo oscuro propio fuera de HA.
- Sin `hass` (abriendo `dist/index.html`) la integración queda inactiva y la
  app es plenamente usable en local.

## Ejemplos de uso en Home Assistant

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

Aviso de proteína a las 20:00. La app solo publica el dato; la automatización
es tuya:

```yaml
alias: Recordatorio de proteína
triggers:
  - trigger: time
    at: "20:00:00"
conditions:
  - condition: numeric_state
    entity_id: input_number.entreno_proteina_restante
    above: 40
actions:
  - action: notify.mobile_app_movil
    data:
      message: "Te quedan {{ states('input_number.entreno_proteina_restante') | int }} g de proteína hoy."
```
