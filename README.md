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
- Las cuentas, sin pantalla (se pueden probar solas): `js/engine.js` (utilidades, datos y sueño), `js/training.js` (lector de series y gasto de los entrenos), `js/balance.js` (gasto real, macros y recuperación) y `js/foodlib.js` (buscador, cocinado y platos).
- Las pantallas: `js/core.js` (datos y navegación), `js/today.js`, `js/foods.js`, `js/addfood.js`, `js/sleep.js`, `js/history.js` y `js/main.js` (arranque).
- `tests/tests.html`: pruebas de las cuentas. `tests/seed.html`: datos inventados para probar (solo en `localhost`).

Para probarla en el ordenador: `python -m http.server 8765` y abre `http://localhost:8765`.

## De dónde salen los números
- Coste de nadar por estilo y velocidad: Capelli, Pendergast y Termin (1998). Aletas y pies: Zamparo y cols. (2002).
- Metabolismo en reposo de deportistas: ten Haaf y Weijs (2014). Gasto tras el esfuerzo: LaForgia y cols. (2006).
- Hidratos, proteína y comidas alrededor del entreno: Burke y cols. (2011); Thomas, Erdman y Burke (2016); Schoenfeld y Aragon (2018).
- Sueño: Walsh y cols. (2021), Mah y cols. (2011), Sargent y cols. (2014), Al Khatib y cols. (2017).
- Energía disponible: Loucks y cols. (2011) y el consenso del COI sobre RED-S (2023).

Todo son estimaciones con margen de error; lo que más afina es el ajuste con tus propios datos (comidas y peso).
