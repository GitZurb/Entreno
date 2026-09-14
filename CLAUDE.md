# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

El código, los comentarios, la interfaz y los mensajes de commit están en
castellano. Mantén ese idioma.

## Qué es

Entrenador personal para un solo usuario, sin cuentas ni backend propio, que se
usa de dos formas con el mismo código:

1. **Autónomo**: `dist/index.html` incrusta el bundle y se abre en cualquier
   navegador. `hass` es nulo y la integración queda inactiva.
2. **Panel de Home Assistant**: `dist/panel.js` se instala con HACS desde este
   repositorio y se usa como tarjeta `custom:entreno-panel` en un dashboard en
   modo panel (también admite el registro clásico con `panel_custom`).

## Comandos

```bash
npm install
npm run build     # dist/panel.js, dist/index.html y dist/resource.js
npm run dev       # lo mismo, reconstruyendo al guardar
```

No hay tests automatizados ni linter en el repositorio. La verificación se hace
abriendo `dist/index.html` en un navegador y recorriendo los flujos; para
comprobar la integración sin Home Assistant, se monta `<entreno-panel>` con un
objeto `hass` simulado (`states`, `services`, `callService`, `callWS`).

`dist/` **se versiona a propósito**: HACS descarga `dist/panel.js` directamente
de la rama. Después de tocar `src/`, reconstruye y haz commit del `dist/`
resultante, o la instalación de HACS se quedará con el código viejo.

## Arquitectura

Toda la aplicación vive en `src/App.jsx` (~3.700 líneas), dividido en secciones
delimitadas por banners de comentario en mayúsculas. Es deliberado: el destino
es un único módulo para Home Assistant, y el orden del archivo va de lo general
a lo concreto. Para orientarte, busca los banners (`grep -n "^ \* [A-ZÁ]"`).

Flujo de dependencias: utilidades → `db` → cálculos puros → `ha` → estado →
primitivas de interfaz → pantallas → elemento personalizado.

### Piezas que hay que entender juntas

- **`db`** es el único módulo que toca IndexedDB. Ninguna pantalla accede al
  almacén directamente; todo pasa por `StoreProvider`, que mantiene una copia en
  memoria y escribe en paralelo. Cambiar de backend debería tocar solo `db`.
  Si IndexedDB no está disponible, cae a memoria sin romper la app.
- **`ha`** concentra la integración. `ha.available` es la única comprobación de
  si hay Home Assistant: fuera de él, todo lo demás queda inerte y la app sigue
  funcionando en local. No dupliques esa comprobación en las pantallas.
- **`useIntegration()`** envuelve cada llamada a servicio: si falla, avisa
  nombrando la entidad, guarda el envío en el store `haQueue` (persistente) y lo
  reintenta al reconectar y cada 60 s. **Un fallo de Home Assistant nunca puede
  hacer perder un entreno.**
- **Cálculo de cargas** (`loadsFor`, `enumerateLoads`, `validateLoad`): los
  discos son un recurso compartido. Lo montado en la barra deja de estar
  disponible para las mancuernas, y al revés. La sesión guarda `mounted` por
  implemento y de ahí sale `occupiedBy`. La barra usa discos de dos en dos; el
  par de mancuernas, de cuatro en cuatro. Cualquier peso que se registre se
  valida contra la lista de cargas montables del momento.
- **Programa de 26 semanas** (`SEED_PROGRAM` + `programPlanFor` +
  `programStatus`): el dato guardado son bloques y días; las series y el RIR de
  cada semana concreta se **derivan** aplicando el modificador de la semana
  dentro del bloque. `programStatus` cruza las sesiones cerradas con el
  calendario para decidir qué toca hoy y qué quedó atrasado.
- **Gráficas**: SVG propio, sin librería (`LineChart`, `StackedBars`,
  `Sparkline`). Se escribieron para bajar el bundle de 817 kB a 222 kB. No
  vuelvas a meter una librería de gráficas sin una razón de peso.

### Invariantes del dominio

- La biblioteca solo puede contener ejercicios ejecutables con el material real:
  banco inclinable, barra olímpica, dos barras de mancuerna, discos, una
  kettlebell y peso corporal. Nada de máquinas, poleas, jaula ni dominadas.
- El peso de la barra olímpica y el de las barras de mancuerna son
  configurables; no los des por fijos en ningún cálculo.
- En mancuernas el peso es **por mancuerna**, y así se etiqueta.
- El incremento mínimo real es de 3 kg (1,5 kg por lado). Las sugerencias de
  progresión nunca proponen porcentajes teóricos: si el salto no es viable,
  proponen repeticiones o series.
- En tren inferior la progresión prioriza dificultad mecánica (tempo, pausas,
  unilateral, rango) sobre los kilos.
- La app **arranca sin registros**. Solo trae material de referencia:
  biblioteca, plantillas, tabla de alimentos y programa. Las sesiones, comidas,
  peso y recetas los crea el usuario. No vuelvas a precargar datos inventados.

### Estilos y tema

Un único string `CSS` inyectado dentro del propio elemento (funciona aunque HA
lo monte en un shadow root). Todos los colores derivan de variables del frontend
de Home Assistant (`--primary-background-color`, `--card-background-color`,
`--primary-text-color`, `--secondary-text-color`, `--divider-color`,
`--primary-color`) con respaldo oscuro propio para cuando la app corre fuera de
HA. No escribas colores literales en los componentes: usa los tokens `--e-*`.

## Empaquetado

`build.mjs` (esbuild) es toda la configuración. Alias `react` → `preact/compat`:
el código se escribe como React y se empaqueta con Preact. Sin dependencias de
CDN en tiempo de ejecución. Genera tres salidas: el módulo, la página autónoma y
una variante comprimida autoextraíble por si hace falta registrarla como recurso
en línea de Lovelace (límite ~128 kB) sin acceso a ficheros.

Los ficheros de `config/www` se sirven con caché agresiva; por eso la URL del
módulo va versionada. HACS lo hace solo con su propio identificador.

## Documentación

- `docs/HOME_ASSISTANT.md`: instalación, helpers, recargas y estado actual de la
  instancia donde está desplegado.
- `docs/PLAN.md`: plan original (modelo de datos, pantallas, algoritmo de
  cargas, decisiones estéticas). Histórico; si algo choca con el código, manda
  el código.
- `docs/ha/`: fragmentos de `configuration.yaml` e `input_number.yaml` para la
  alternativa con `panel_custom`.
