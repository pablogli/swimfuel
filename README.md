# SwimFuel

Planificador y diario de nutrición para nadadores. Calcula cuánto comer cada día según el entrenamiento (agua, gimnasio, tipo de sesión) y lleva el registro de las comidas.

## Instalar en el móvil
- **Android (Chrome):** abre la web → menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** abre la web → Compartir → *Añadir a pantalla de inicio*.

Funciona sin conexión. Los datos (comidas, diario, clave de Gemini) se guardan solo en el dispositivo, nunca en este repositorio: haz una copia de seguridad de vez en cuando desde la pestaña *Histórico*.

## Actualizar la app
1. Cambia los archivos y súbelos.
2. Sube el número de `CACHE` en `sw.js` (por ejemplo `swimfuel-v7`). El móvil descarga la versión nueva entera y la app avisa con "Hay una versión nueva: Recargar".
3. Si añades un archivo nuevo a la app, añádelo también a la lista `ASSETS` de `sw.js`.

## Cómo está organizada
- `index.html`: la pantalla. `css/app.css`: el diseño.
- `js/engine.js`: las cuentas (gasto, series, sueño), sin pantalla. `js/core.js`: datos y navegación. `js/today.js`, `js/foods.js`, `js/sleep.js`, `js/history.js`: cada pestaña. `js/main.js`: arranque.
- `tests/tests.html`: pruebas de las cuentas. `tests/seed.html`: datos inventados para probar (solo en `localhost`).

Para probarla en el ordenador: `python -m http.server 8765` y abre `http://localhost:8765`.
