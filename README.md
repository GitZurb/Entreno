# Entreno

Entrenador personal para un solo usuario: entrenamientos, alimentación y progreso en
el mismo sitio, sin login ni backend propio, pensado para integrarse como panel
personalizado (`panel_custom`) de Home Assistant.

- `src/App.jsx` — toda la aplicación en un único archivo React.
- `build.mjs` — cadena de construcción (esbuild), única para las dos fases.
- `dist/index.html` — fase 1: página autónoma con el bundle incrustado (se abre en
  cualquier navegador o como artifact).
- `dist/panel.js` — fase 2: módulo ES autocontenido para `config/www/entrenador/`.
- `docs/PLAN.md` — modelo de datos, mapa de pantallas, algoritmo de cargas y estética.

## Construir

```bash
npm install
npm run build      # genera dist/panel.js y dist/index.html
npm run dev        # lo mismo, reconstruyendo al guardar
```

Sin dependencias de CDN en tiempo de ejecución: Preact, los iconos y las gráficas
(SVG propio, sin librería) van dentro del bundle (223 kB minificado, 65 kB con gzip).

## Fase 1 · aplicación autónoma

Abre `dist/index.html`. Los datos viven en IndexedDB del navegador (exportación e
importación JSON completa en Ajustes → Datos). Arranca vacío de registros: solo
trae material de referencia (60 ejercicios con técnica e ilustración, tres
plantillas de rutina, una tabla de alimentos y el programa de 26 semanas). Las
sesiones, las comidas, el peso y las recetas los creas tú. Fuera de Home Assistant `hass` es nulo y la
integración queda inactiva; la pantalla de Ajustes → Home Assistant ya está
construida y se rellena con entidades reales cuando el panel corre dentro de HA.

## Programa de 26 semanas

`SEED_PROGRAM` en `src/App.jsx` define cinco bloques (Base y técnica, Acumulación,
Intensificación, Consolidación y densidad, Cierre y test) con cinco días por semana,
modificadores por semana (series extra y RIR objetivo, descarga en la sexta) y cinco
fases de alimentación. El motor (`programPlanFor`, `programStatus`) calcula el plan
concreto de cada semana y el estado de las 130 sesiones; una sesión no hecha se
desplaza al siguiente día de entreno o se salta desde la vista Programa. Restricciones
incorporadas: rodilla sensible (pierna con poca carga, tempo y pausas), sin ayudante
(press con mancuernas y press de suelo) y 10.000 pasos diarios.

## Ilustraciones

Cada ejercicio tiene un pictograma vectorial propio (`EXERCISE_FIGURES`): una figura de
perfil parametrizada por ángulos con dos fotogramas, inicio y final, más una silueta
con los músculos implicados. Todo va dentro del bundle, sin imágenes externas.

## Fase 2 · panel de Home Assistant

El mismo bundle `dist/panel.js` se copia a `config/www/entrenador/panel.js` y se
registra con `panel_custom` (`embed_iframe: false`). El elemento `<entreno-panel>`
implementa los setters `hass`, `narrow`, `route` y `panel`. Los ficheros de
`config/www` se sirven con caché agresiva: versiona la URL del módulo
(`/local/entrenador/panel.js?v=X.Y.Z`) en cada actualización.

Instalado con HACS como repositorio personalizado, con el dashboard «Entreno» y
los cinco helpers creados. Guía completa y estado: `docs/HOME_ASSISTANT.md`.
Fragmentos listos para copiar: `docs/ha/configuration.yaml` y `docs/ha/input_number.yaml`.
