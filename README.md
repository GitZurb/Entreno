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
(SVG propio, sin librería) van dentro del bundle (237 kB minificado, 72 kB con gzip).

## Interfaz

Dashboard minimalista construido sobre una única pieza reutilizable, la burbuja
(`BubbleCard`): icono en círculo, título, subtítulo, acción y contenido, con
esquinas de 24 px, mucho espacio negativo y sin bordes ni sombras marcadas. De ahí
derivan `MetricBubble` (métricas compactas), `ProgressBubble`, `WorkoutBubble`,
`ExerciseBubble` (ejercicio con series desplegables), `SectionHeader`,
`StatusBadge` y `ActionButton`. La rejilla es de 12 columnas (`e-grid` + `e-c3`,
`e-c4`, `e-c6`, `e-c8`): un mismo sistema que en móvil apila y en escritorio
reparte. Todos los colores salen de las variables del frontend de Home Assistant,
así que la app adopta el tema de HA (claro u oscuro) y fuera de él usa su propio
respaldo oscuro.

## Fase 1 · aplicación autónoma

Abre `dist/index.html`. Los datos viven en IndexedDB del navegador (exportación e
importación JSON completa en Ajustes → Datos). Arranca vacío de registros: solo
trae material de referencia (60 ejercicios con técnica e ilustración, tres
plantillas de rutina, una tabla de alimentos y el programa de 26 semanas). Las
sesiones, las comidas, el peso y las recetas los creas tú. Fuera de Home Assistant `hass` es nulo y la
integración queda inactiva; la pantalla de Ajustes → Home Assistant ya está
construida y se rellena con entidades reales cuando el panel corre dentro de HA.

## Programa de 26 semanas

`SEED_PROGRAM` en `src/App.jsx` define seis meses de entrenamiento en cinco
bloques —Calibración y base, Acumulación, Fuerza escalonada, Densidad, y Pico y
test— sobre cinco días fijos de la semana: **lunes push, martes pull, miércoles
full body de fuerza, viernes torso mixto y domingo full body metabólico**
(`dayOffsets: [0, 1, 2, 4, 6]`). Jueves y sábado son de descanso activo.

La semana 1 es de **calibración**: el plan no trae kilos escritos. Se busca el
peso que deje 3 repeticiones en recámara y de ahí sale la progresión, que es
escalonada y siempre dentro de las cargas realmente montables con el material
del usuario: saltos de 3 kg en barra (20 · 23 · 26 · 30 …) y una escalera
mucho más basta en mancuernas (5 · 12 · 15 · 22 · 25 · 32 · 35 por mancuerna,
porque los discos van de cuatro en cuatro). Cuando el escalón que toca es de
7 kg, se progresa con repeticiones y series en vez de forzar el salto.

Los modificadores por semana (`MODS_BASE`, `MODS_6`, `MODS_TEST`) añaden series
y bajan el RIR dentro de cada bloque, con descarga en la última semana de los
bloques largos. El motor (`programPlanFor`, `programStatus`) calcula el plan
concreto de cada semana y el estado de las 130 sesiones; una sesión no hecha se
desplaza o se salta desde la vista Programa. Restricciones incorporadas: rodilla
sensible (pierna por tempo, pausas y unilateral, no por kilos), sin ayudante
(empuje pesado con mancuernas y press de suelo), sesiones de ~60 min y déficit
calórico por fases.

Desde la vista Programa, **Publicar** vuelca las 130 sesiones al calendario de
Home Assistant como eventos de día completo, con los ejercicios y el RIR
objetivo del día en la descripción.

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
