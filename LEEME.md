# Pilo Presupuestos — presupuestos eléctricos con precios AAIERIC

App para armar y exportar presupuestos de instalaciones eléctricas, con el
listado de costos sugeridos de AAIERIC ya cargado (Julio 2026, 98 ítems).
Funciona en el navegador, sin conexión a internet una vez abierta, y guarda
todo en el propio dispositivo (no se manda nada a ningún servidor).

## Novedades de esta versión

- **Pantalla de Inicio**, con accesos a AEA/AAIERIC/Prysmian y a los
  comercios de Venado Tuerto (ver `images/README.txt` para poner tus
  propias fotos).
- Pestañas reorganizadas: **Presupuestos** (nuevo + guardados), **Negocio**
  (datos + Clientes) y **Precios** siguen igual que antes, agrupadas con
  sub-pestañas arriba.
- Pestaña nueva **Cálculos**, con dos herramientas según AEA 90364:
  - **Caída de Tensión**: calculadora en vivo (monofásico/trifásico,
    cobre/aluminio, por potencia o corriente).
  - **Grado de Electrificación y Circuitos**: subís el plano, marcás la
    escala, dibujás cada ambiente y las canalizaciones (con colores), y
    la app calcula grado de electrificación, bocas mínimas, circuitos
    sugeridos y una lista de materiales estimada — exportable a PDF.

Estos cálculos son **orientativos** (así se aclara también dentro de la
app y en el PDF): sirven para armar el presupuesto y organizar la obra
rápido, pero no reemplazan el proyecto ejecutivo firmado por un
instalador matriculado.

## Forma más simple de usarla (sin instalar nada)

1. Descomprimí la carpeta.
2. Abrí el archivo `index.html` con Chrome o Edge (doble clic, o clic derecho
   → Abrir con).
3. Listo, ya podés armar presupuestos. Podés volver a abrir ese mismo archivo
   cuando quieras: los datos quedan guardados en ese navegador.

Esto funciona tanto en Windows como en el celular (copiá la carpeta a
"Descargas" del celular y abrí `index.html` con Chrome).

**Ojo:** si abrís el archivo así (directo, sin subirlo a internet), el ícono
de "instalar como app" de Android no va a aparecer, y si algún día borrás la
carpeta se pierden los presupuestos guardados en ese navegador puntual. Para
eso está la opción de abajo.

## Opción recomendada: instalarla como app de verdad (ícono propio, funciona
offline, un solo lugar para tus datos en el celu y la PC)

Necesitás "subir" estos archivos a algún lugar con https — es gratis y no
hace falta saber programar. La forma más simple es GitHub Pages:

1. Creá una cuenta gratis en [github.com](https://github.com) si no tenés.
2. Creá un repositorio nuevo (botón verde "New"), público, con cualquier
   nombre (ej: `mis-presupuestos`).
3. En la página del repositorio, "Add file" → "Upload files", y arrastrá
   *todo el contenido* de la carpeta `dist` (no la carpeta en sí, lo que
   está adentro).
4. Andá a Settings → Pages, en "Branch" elegí `main` y guardá.
5. En un par de minutos te da un link tipo
   `https://tu-usuario.github.io/mis-presupuestos/`. Ese es el link de tu
   app.
6. Abrí ese link en el celu con Chrome → menú (⋮) → "Instalar app" (o
   "Agregar a pantalla de inicio"). En Windows, con Edge o Chrome, aparece
   un ícono de instalar en la barra de direcciones.

Una vez instalada te queda un ícono como cualquier otra app, funciona sin
internet, y podés actualizarla subiendo archivos nuevos al mismo
repositorio cuando yo te pase una versión nueva.

Si preferís, cualquier otro hosting gratuito con https sirve igual (Netlify,
Vercel, Cloudflare Pages, tu propio hosting, etc.) — simplemente subís el
contenido de `dist` tal cual está.

## Probarla como APK en tu celular

Ya te dejé armado un "robot" (en GitHub Actions, igual que el de los
precios) que te compila un archivo APK instalable, usando las
herramientas oficiales de Android — algo que yo no puedo generar
directamente en esta conversación, por eso lo hace GitHub por vos, gratis.

**Requisito**: que ya hayas subido la carpeta a GitHub (el paso "Opción
recomendada" de más arriba). Si todavía no lo hiciste, hacelo primero —
lleva 2 minutos.

Pasos:

1. En tu repositorio de GitHub, andá a la pestaña **Actions**.
2. En la lista de la izquierda, tocá **"Compilar APK de prueba"**.
3. Botón **"Run workflow"** → confirmá. Tarda unos 3-5 minutos.
4. Cuando termine (círculo verde ✓), entrá a esa ejecución y bajá hasta
   **Artifacts** → descargá `pilo-presupuestos-debug-apk`.
5. Es un .zip — adentro está el `.apk`. Copialo a tu celular (por
   WhatsApp a vos mismo, Google Drive, un cable, lo que te resulte más
   cómodo) y abrilo con el explorador de archivos del celular para
   instalarlo.
6. Android te va a decir que "no se permiten instalar apps de origen
   desconocido" — tocá **Configuración** ahí mismo y habilitalo (es
   normal, pasa con cualquier app que no venga de Play Store) y volvé a
   tocar el archivo para instalar.

Esta primera versión es de **prueba** (firma de "debug", no la
definitiva de Play Store) — perfecta para que la uses vos y se la pases
a los colegas que te ayuden a probarla, pero cuando llegue el momento de
publicarla en Google Play vamos a generar una firma "de verdad" (esa sí
hay que guardarla con mucho cuidado, porque si se pierde no se puede
volver a actualizar la misma app nunca más).

**Una diferencia con la versión que abrís en el navegador**: en esta APK,
el chequeo automático de precios de AAIERIC queda "congelado" con los
precios del momento en que se compiló (no se actualiza solo todos los
días como la versión web) — para eso, en esta primera versión de prueba,
seguís usando "Actualizar desde un PDF" a mano dentro de la app, o
recompilás el APK de nuevo. Cuando pasemos a la versión de Play Store lo
resolvemos para que ande igual que en la web.

En cambio, **exportar y compartir el PDF por WhatsApp mejora** en esta
versión: en vez de sólo abrir WhatsApp con un texto (como en el
navegador), acá te abre directamente el selector de "compartir" de
Android con el PDF ya adjunto, listo para elegir WhatsApp, Gmail, Drive,
lo que quieras.

## Cómo se actualizan los precios de AAIERIC

Hay dos formas, y las dos conviven sin problema:

### 1. Automático (recomendado, no tenés que hacer nada)

Si la app está alojada en GitHub Pages (ver más abajo), un robot revisa la
página de AAIERIC **una vez por día** solo, sin que vos hagas nada. Si
encuentra precios distintos a los que tenés cargados, la próxima vez que
abras la app te va a aparecer un aviso arriba de todo:

> AAIERIC actualizó 3 precios (Agosto 2026) — **Revisar cambios**

Tocás "Revisar cambios", te muestra viejo vs. nuevo para cada ítem (podés
destildar los que no quieras aplicar) y confirmás. Lo que no se pueda leer
automáticamente queda señalado para que lo edites a mano.

Este chequeo automático corre una vez al día (a las 10 AM hora Argentina).
Si en algún momento querés forzarlo antes, andá a la pestaña **Actions** de
tu repositorio en GitHub → "Chequear precios AAIERIC" → botón **Run
workflow**. También podés tocar "Ver estado automático" dentro de la app
para ver cuándo fue el último chequeo (y si vino fallando).

**Para que esto funcione hace falta que la app esté subida a GitHub Pages**
(no alcanza con abrir `index.html` sueltamente desde tu PC) — es el paso
"Opción recomendada" de más abajo. Al subir los archivos, asegurate de
incluir la carpeta oculta `.github` (algunos exploradores de archivos la
esconden por default). Si arrastrar y soltar no la toma, la alternativa es:
en GitHub, botón "Add file" → "Create new file", como nombre escribí
`.github/workflows/check-aaieric-precios.yml` (con esas barras, GitHub crea
las carpetas solo) y pegás el contenido de ese archivo tal cual está en el
zip.

### 2. Manual (subiendo el PDF vos)

Sigue andando igual que antes, y es la única opción si no alojás la app en
ningún lado: descargás el PDF de aaieric.org.ar/costos-mano-de-obra y en la
app: **Precios AAIERIC → Actualizar desde un PDF**. Mismo modal de revisión
de cambios que el automático.

### En cualquier momento

Podés tocar el precio de cualquier ítem en "Precios AAIERIC" y escribir el
que quieras (por ejemplo tu propio descuento) — queda marcado con un
puntito naranja. El chequeo automático compara contra el último precio
*oficial* de AAIERIC, no contra tus ajustes, así que tu descuento no te va
a generar avisos falsos.

## Qué incluye

- **Nuevo presupuesto**: buscás ítems del listado de AAIERIC o cargás los
  tuyos (materiales, etc.), con cantidad y precio editables. Descuento
  global e IVA opcional. Vista previa tipo hoja de presupuesto en vivo.
- **Presupuestos**: quedan guardados con número correlativo, podés volver a
  abrirlos, descargar el PDF de nuevo o eliminarlos.
- **Clientes**: se guardan solos al guardar un presupuesto, o los cargás vos.
- **Precios AAIERIC**: los 98 ítems del listado oficial, editables. Se
  chequean solos contra la web de AAIERIC una vez por día (ver más abajo).
- **Mi negocio**: tu nombre/logo/datos de contacto, que aparecen en el PDF.
- **Cálculos**: Caída de Tensión y Grado de Electrificación y Circuitos
  (con plano, ambientes, canalizaciones y lista de materiales), según AEA
  90364. Ver "Novedades de esta versión" más arriba.
- **Exportar PDF**: presupuesto con tu marca, listo para mandar.
- **Compartir por WhatsApp**: en el celular abre directo el selector para
  adjuntar el PDF; en PC se descarga el PDF y se abre WhatsApp Web con un
  mensaje armado para que lo adjuntes vos.

## Privacidad

Todo (presupuestos, clientes, precios, tu logo) se guarda únicamente en el
dispositivo donde la usás, en el navegador. Si la instalás en el celular y
en la PC, son dos "cajones" de datos separados — no se sincronizan solos
entre sí.
