# Entreno · Plan de fase 1

Entrenador personal para un solo usuario, sin backend propio, pensado para
acabar como panel `panel_custom` de Home Assistant. Este documento fija el
modelo de datos, el mapa de pantallas, el algoritmo de cargas montables y las
decisiones estéticas. Se implementa cuando el plan reciba el visto bueno.

## 1. Modelo de datos (IndexedDB, base `entreno`, versión 1)

Todo el acceso pasa por un único módulo `db` con `get/put/del/list/export/import`.
La interfaz nunca toca IndexedDB directamente, así que el backend se puede
sustituir sin tocar pantallas.

| Store        | Clave | Contenido |
|--------------|-------|-----------|
| `settings`   | `"app"` | `barbellKg` (20), `dumbbellBarKg` (2), `restDefaultSec` (90), `profile` {alturaCm 173, diasSemana 5, nivel, objetivo}, `goals` {kcal, proteinaG, carbosG, grasaG, aguaMl}, `ha` {enabled, scaleEntity, calendarEntity, todoEntity, notifyService, ttsService, sceneStart, sceneEnd, helpers {weeklyVolume, weeklySessions, adherence, dayTonnage, proteinLeft}, notifyOnRest} |
| `inventory`  | `"main"` | `plates` [{kg, count}] → 10×4, 5×4, 1.5×4; `bars` {olympic:1, dumbbell:2}; `kettlebells` [{kg:10,count:1}]; `bench` {incline:true, decline:true} |
| `exercises`  | `id` | `name`, `muscle` (pecho, espalda, hombro, bíceps, tríceps, cuádriceps, isquios, glúteo, core), `secondary[]`, `equipment` (barbell, dumbbell_pair, dumbbell_single, kettlebell, bodyweight, bench), `loadMode` (barbell, per_dumbbell, kettlebell, bodyweight), `unilateral`, `lower` (tren inferior), `restSec`, `notes` |
| `routines`   | `id` | `name`, `days` [{name, blocks [{exerciseId, sets, repsMin, repsMax, restSec}]}] |
| `sessions`   | `id` | `date`, `routineId`, `dayIndex`, `dayName`, `startedAt`, `finishedAt`, `exercises` [{exerciseId, restSec, sets [{kg, reps, rir, done, pr}]}], `tonnage`, `note` |
| `foods`      | `id` | `name`, `per` (`100g` \| `unit`), `unitLabel`, `kcal`, `protein`, `carbs`, `fat` |
| `recipes`    | `id` | `name`, `servings`, `items` [{foodId, qty}] |
| `diary`      | `date` | `meals` {desayuno, comida, cena, snacks: [{foodId \| recipeId, qty}]}, `waterMl` |
| `bodyweight` | `date` | `kg`, `source` (`manual` \| `ha`) |
| `haQueue`    | `id`  | `domain`, `service`, `data`, `createdAt`, `attempts`, `lastError` |

Datos derivados, no almacenados: 1RM estimado (Epley: `kg × (1 + reps/30)`),
récords personales (mejor 1RM y mejor kg×reps por ejercicio hasta esa fecha),
volumen semanal por grupo (series con `done` y RIR ≤ 4 cuentan como
efectivas; secundarios cuentan 0,5), adherencia (sesiones cerradas ÷ 5),
media móvil de 7 días del peso.

Peso corporal: si HA está activo y hay entidad de báscula, la serie de HA es la
fuente y los registros manuales solo rellenan días sin lectura.

## 2. Mapa de pantallas

Navegación inferior fija con cuatro secciones; el engranaje de la cabecera abre
Ajustes como pantalla completa.

- **Hoy**: día previsto de la rutina activa (con botón "Empezar"), adherencia
  de la semana (5 puntos), kcal y macros restantes (anillos), peso actual con
  tendencia 7 d, agua del día.
- **Entreno**
  - Rutinas: lista de plantillas, duplicar, editar (añadir/quitar ejercicios,
    series, rango de reps, descanso), elegir día y empezar.
  - Sesión activa: cabecera con cronómetro y material montado; por ejercicio,
    última sesión visible, filas densas `kg · reps · RIR · ✓`, selector de carga
    con solo pesos montables, botón "repetir anterior", sugerencia de
    progresión, temporizador de descanso a pantalla completa al cerrar serie.
    Cerrar sesión: resumen (tonelaje, series, PRs) y publicación a HA.
  - Biblioteca: buscador, filtro por grupo y material, ficha con técnica,
    historial y gráfica de 1RM, alta/edición de ejercicios.
  - Calendario mensual con días entrenados.
- **Comida**: diario del día por comidas, añadir alimento o receta con
  cantidad, anillos de objetivo, agua; pestañas Alimentos y Recetas (CRUD);
  botón "Lista de la compra" (HA).
- **Progreso**: peso con media móvil 7 d, volumen semanal por grupo (barras
  apiladas), 1RM por ejercicio seleccionable, PRs recientes.
- **Ajustes**: perfil y objetivos; inventario de material (discos, barras,
  kettlebells, banco) y peso de barras; Home Assistant (interruptor,
  selectores de entidad filtrados por dominio, estado de la cola); datos
  (exportar/importar JSON, restaurar ejemplos).

## 3. Algoritmo de cargas montables

Entrada: inventario, peso de barras, `loadMode` del ejercicio y los discos ya
ocupados en otros implementos de la sesión.

1. **Discos libres**: `libres[kg] = count[kg] − ocupados[kg]`. Un implemento
   ocupa discos desde que se le asigna una carga hasta que se completan sus
   series o se pulsa "descargar". La sesión guarda `mounted = {barbell:
   {kg, plates}, dumbbells: {kg, plates}}`; al elegir carga en un implemento se
   libera la carga anterior de ese mismo implemento.
2. **Simetría**: en barra, cada tipo de disco se usa en pares
   (`pares[kg] = floor(libres[kg] / 2)`). En par de mancuernas, cada tipo se
   usa de cuatro en cuatro (`cuartetos[kg] = floor(libres[kg] / 4)`), porque
   las dos mancuernas deben ir iguales y cada una simétrica. Mancuerna única
   (trabajo a una mano) usa pares como la barra.
3. **Enumeración**: producto cartesiano de `0..pares[kg]` para cada tipo de
   disco (con 3 tipos y ≤2 pares, 27 combinaciones), suma por lado,
   `total = barra + 2 × lado`; se deduplica y ordena. Para cada total se guarda
   la combinación con menos discos para mostrarla ("20 + 10 + 1,5 por lado").
4. **Resultado con el inventario actual**:
   - Barra: 20, 23, 26, 30, 33, 36, 40, 43, 46, 50, 53, 56, 60, 63, 66, 70, 73,
     76, 80, 83, 86.
   - Par de mancuernas (por mancuerna): 2, 5, 12, 15, 22, 25, 32, 35.
   - Mancuerna única: 2, 5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 38, 42, 45, 48,
     52, 55, 58, 62, 65, 68.
   - Kettlebell: 10. Peso corporal: 0 (opcional lastre con disco sobre el
     pecho o kettlebell).
5. **Validación**: al escribir un peso a mano se comprueba que existe en la
   lista; si no, aviso con el montable más cercano por arriba y por abajo y
   el motivo (discos ocupados en la barra, sin discos suficientes).
6. **Progresión** (doble progresión): si todas las series de la última sesión
   alcanzaron el tope del rango con RIR ≥ 1, se propone la siguiente carga de
   la lista. Si ese salto supera 3 kg en barra o 3 kg por mancuerna (ocurre en
   mancuernas al pasar de 5 a 12), se propone antes +1 repetición o +1 serie.
   En ejercicios marcados `lower` con carga ≥ 60 kg (≈70 % del máximo de 86)
   la sugerencia prioriza tempo 3-1-1, pausa abajo, variante unilateral o
   rango completo antes que kilos.

## 4. Decisiones estéticas

Todos los colores se leen de variables de HA con respaldo propio:

| Token | Variable HA | Respaldo |
|-------|-------------|----------|
| fondo | `--primary-background-color` | `#0B0D10` |
| tarjeta | `--card-background-color` | `#15181D` |
| tarjeta elevada | `--secondary-background-color` | `#1D2127` |
| divisor | `--divider-color` | `#262B33` |
| texto | `--primary-text-color` | `#F2F4F7` |
| texto secundario | `--secondary-text-color` | `#8B93A1` |
| acento | `--primary-color` (con `--accent-color` como segunda opción) | `#4F8CFF` |
| éxito / PR | `--success-color` | `#3DDC97` |
| error / exceso | `--error-color` | `#FF5C5C` |
| aviso | `--warning-color` | `#FFB547` |

Se usa `--primary-color` como acento porque en HA es el color de los
controles interactivos; `--accent-color` (naranja por defecto) queda como
segunda opción. Fuera de HA el tema es oscuro fijo.

Tipografía: `var(--primary-font-family, Inter, Roboto, system-ui, sans-serif)`
con `font-variant-numeric: tabular-nums` global. Escala: 12 (etiquetas), 13
(secundario), 15 (base), 17 (títulos de tarjeta), 22 (títulos de pantalla),
28 (cifras medianas), 40 (cifras grandes), 56 (cifra protagonista). Pesos 400,
500 y 600.

Espaciado en base 4: 4, 8, 12, 16, 24, 32. Tarjetas con radio 16 y padding
16; botones radio 12, altura mínima 48; filas de series altura 52; nav
inferior 64 + `env(safe-area-inset-bottom)`. Contenido a ancho completo en
móvil y máximo 720 px centrado en escritorio (Progreso a dos columnas desde
900 px). Sin gradientes; una sola animación de 180 ms (escala y color) al
completar serie y un contador que sube al cerrar sesión.

Gráficas con recharts (línea de peso con media móvil, barras apiladas de
volumen, línea de 1RM). Iconos con lucide-react.

## 5. Entrega de fase 1

Un único archivo React ejecutable como artifact, con datos de ejemplo
(biblioteca de ~40 ejercicios, plantillas Torso/Pierna 4 días, Push Pull Legs
y Full Body 3 días, dos sesiones históricas, un día de comidas, 30 días de
peso), persistencia en IndexedDB, exportación/importación JSON y la pantalla
de Ajustes completa con la integración de HA desactivada. La capa `ha` se
construye entera (setters `hass/narrow/route/panel`, `callService`,
`callWS`, cola de reintentos) detrás de una única comprobación `hass != null`,
para que la fase 2 solo añada el empaquetado.
