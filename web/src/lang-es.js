// Spanish for the runtime views. Keys are the English templates used with t() and
// tn() in web/src; {placeholders} must match the English ones (test/web-lang.test.js
// checks it). A key missing here shows in English.
//
// Not translated on purpose: the pull request kit (branch, commands, commit message,
// title, description) and the JSON report, which go into someone else's repository,
// and the engine's reasons for files it could not parse.

export const ES = {
  // --- Assessment (assess.js) ---
  'Too large to analyze as a whole': 'Demasiado grande para analizarlo completo',
  'Not supported by this version': 'No compatible con esta versión',
  '{n} JavaScript file will be analyzed.': 'Se analizará {n} archivo JavaScript.',
  '{n} JavaScript files will be analyzed.': 'Se analizarán {n} archivos JavaScript.',
  'A web entry point (index.html) was found: the live run will be available.':
    'Se encontró un punto de entrada web (index.html): la ejecución en vivo estará disponible.',
  'No index.html in the selected folder: the diff, the download and the pull request kit will be available, but not the live run.':
    'No hay index.html en la carpeta elegida: tendrás el diff, la descarga y el kit de pull request, pero no la ejecución en vivo.',
  'An index.html exists in {folders}. Select that folder to get the live run.':
    'Hay un index.html en {folders}. Elige esa carpeta para tener la ejecución en vivo.',
  'Files in other languages ({list}) will be left untouched.': 'Los archivos en otros lenguajes ({list}) no se tocarán.',
  '{list} are not processed by this version.': '{list}: esta versión no los procesa.',
  'This means the repository can be analyzed. The run may still end with no changes if nothing can be changed provably safely.':
    'Esto significa que el repositorio se puede analizar. La ejecución puede terminar sin cambios si nada se puede cambiar de forma demostrablemente segura.',
  'Can be resurrected': 'Se puede resucitar',
  'Can be resurrected, without live run': 'Se puede resucitar, sin ejecución en vivo',
  'GhostRepo v1 modernizes only JavaScript/web code.': 'GhostRepo v1 solo moderniza código JavaScript/web.',
  'No eligible .js files were found.': 'No se encontraron archivos .js elegibles.',
  '{n} minified (.min.js)': '{n} minificados (.min.js)',
  '{n} inside node_modules/ or .git/': '{n} dentro de node_modules/ o .git/',
  '.js files that are excluded on purpose: {list}.': 'Archivos .js excluidos a propósito: {list}.',
  'GitHub returned only a partial file listing for this repository, so it cannot be assessed as a whole.':
    'GitHub devolvió solo una lista parcial de archivos de este repositorio, así que no se puede evaluar completo.',
  'It has {files} files ({mb} MB); the limit is {maxFiles} files and {maxMb} MB.':
    'Tiene {files} archivos ({mb} MB); el límite es {maxFiles} archivos y {maxMb} MB.',
  'Select a subfolder to analyze only that part of the repository.': 'Elige una subcarpeta para analizar solo esa parte del repositorio.',
  'This repository looks mostly like {lang}: {n} file with {lang} extensions (detected from file extensions), and 0 eligible .js files.':
    'Este repositorio parece ser principalmente {lang}: {n} archivo con extensión de {lang} (detectado por las extensiones de archivo) y 0 archivos .js elegibles.',
  'This repository looks to include {lang}: {n} file with {lang} extensions (detected from file extensions), and 0 eligible .js files.':
    'Este repositorio parece incluir {lang}: {n} archivo con extensión de {lang} (detectado por las extensiones de archivo) y 0 archivos .js elegibles.',
  'This repository looks mostly like {lang}: {n} files with {lang} extensions (detected from file extensions), and 0 eligible .js files.':
    'Este repositorio parece ser principalmente {lang}: {n} archivos con extensión de {lang} (detectado por las extensiones de archivo) y 0 archivos .js elegibles.',
  'This repository looks to include {lang}: {n} files with {lang} extensions (detected from file extensions), and 0 eligible .js files.':
    'Este repositorio parece incluir {lang}: {n} archivos con extensión de {lang} (detectado por las extensiones de archivo) y 0 archivos .js elegibles.',

  // --- Dates (dom.js) ---
  today: 'hoy',
  '{n} day ago': 'hace {n} día',
  '{n} days ago': 'hace {n} días',
  '{n} month ago': 'hace {n} mes',
  '{n} months ago': 'hace {n} meses',
  '{n} year ago': 'hace {n} año',
  '{n} years ago': 'hace {n} años',

  // --- Link validation (github-url.js) ---
  'The subfolder must not start with "-".': 'La subcarpeta no puede empezar con "-".',
  'The subfolder must be relative, for example "apps/calculator".': 'La subcarpeta debe ser relativa, por ejemplo "apps/calculator".',
  'Use forward slashes in the subfolder, for example "apps/calculator".': 'Usa barras normales (/) en la subcarpeta, por ejemplo "apps/calculator".',
  'The subfolder must not contain "." or ".." segments.': 'La subcarpeta no puede contener segmentos "." o "..".',
  'Paste the URL of a GitHub repository, for example {example}.': 'Pega la URL de un repositorio de GitHub, por ejemplo {example}.',
  'That is not a URL. Use the full address, for example {example}.': 'Eso no es una URL. Usa la dirección completa, por ejemplo {example}.',
  'Only https:// links are accepted, for example {example}.': 'Solo se aceptan enlaces https://, por ejemplo {example}.',
  'Only GitHub repositories are supported, for example {example}.': 'Solo se admiten repositorios de GitHub, por ejemplo {example}.',
  'Remove credentials or ports from the link, for example {example}.': 'Quita las credenciales o el puerto del enlace, por ejemplo {example}.',
  'The link contains an invalid percent-encoded character.': 'El enlace contiene un carácter codificado con % que no es válido.',
  'The link must point to a repository, for example {example}.': 'El enlace debe apuntar a un repositorio, por ejemplo {example}.',
  '"{name}" is not a valid owner/repository name.': '"{name}" no es un nombre válido de propietario/repositorio.',
  'Only repository links and /tree/<branch>/<folder> links are supported, not files or other pages.':
    'Solo se admiten enlaces a un repositorio y enlaces /tree/<rama>/<carpeta>, no a archivos ni a otras páginas.',
  'The branch name must not start with "-".': 'El nombre de la rama no puede empezar con "-".',

  // --- GitHub errors (github.js, main.js) ---
  ' Try again after {time}.': ' Vuelve a intentarlo después de las {time}.',
  'Could not reach GitHub. Check your connection and try again.': 'No se pudo conectar con GitHub. Revisa tu conexión y vuelve a intentarlo.',
  "GitHub's limit for anonymous requests was reached.": 'Se alcanzó el límite de GitHub para peticiones anónimas.',
  '{name} was not found. It may not exist or it may be private (GitHub does not distinguish the two without a login, and only public repositories are supported).':
    'No se encontró {name}. Puede que no exista o que sea privado (sin iniciar sesión GitHub no distingue los dos casos, y solo se admiten repositorios públicos).',
  'GitHub answered with an unexpected status {status}.': 'GitHub respondió con un estado inesperado: {status}.',
  'That repository is empty: it has no commits.': 'Ese repositorio está vacío: no tiene commits.',
  'The branch or tag "{ref}" does not exist in {name}. Links to branches whose name contains "/" are not supported yet.':
    'La rama o etiqueta "{ref}" no existe en {name}. Los enlaces a ramas cuyo nombre contiene "/" todavía no se admiten.',
  'The folder "{folder}" was not found in {name} at that branch.': 'La carpeta "{folder}" no se encontró en {name} en esa rama.',
  'The file listing of {name} was not found.': 'No se encontró la lista de archivos de {name}.',
  'Could not download {path} (status {status}).': 'No se pudo descargar {path} (estado {status}).',
  'GitHub rate limit reached': 'Límite de GitHub alcanzado',
  'Repository not found': 'Repositorio no encontrado',
  'Branch not found': 'Rama no encontrada',
  'Folder not found': 'Carpeta no encontrada',
  'Empty repository': 'Repositorio vacío',
  'Cannot reach GitHub': 'No se puede conectar con GitHub',
  'A file could not be downloaded': 'No se pudo descargar un archivo',
  'Unexpected answer from GitHub': 'Respuesta inesperada de GitHub',
  'Something went wrong': 'Algo salió mal',
  'Try again': 'Reintentar',
  'The resurrection failed.': 'La resurrección falló.',
  'The resurrection worker failed to start.': 'El proceso de resurrección no pudo iniciarse.',

  // --- Page flow (main.js) ---
  'GhostRepo · Raise dead JavaScript repositories': 'GhostRepo · Resucita repositorios JavaScript muertos',
  '☠ Firefox OS calculator (dead web app)': '☠ Calculadora de Firefox OS (web app muerta)',
  '🎮 Mozilla game template (archived 2012)': '🎮 Plantilla de juego de Mozilla (archivada en 2012)',
  '📱 Mozilla app template (archived)': '📱 Plantilla de app de Mozilla (archivada)',
  '🐍 A Python project (not supported)': '🐍 Un proyecto en Python (no compatible)',
  'Assessing {name}…': 'Evaluando {name}…',
  'Assessing the repository…': 'Evaluando el repositorio…',
  'Reading the file listing from GitHub. No code is downloaded or run yet.':
    'Leyendo la lista de archivos de GitHub. Todavía no se descarga ni se ejecuta código.',
  'Assessing the repository': 'Evaluando el repositorio',
  'Resurrecting {name}…': 'Resucitando {name}…',
  Resurrecting: 'Resucitando',
  '{title} (during {phase})': '{title} (durante {phase})',
  '{title} during {phase}': '{title} durante {phase}',
  Code: 'Código',
  Run: 'Ejecutar',
  Download: 'Descargar',
  'Pull request': 'Pull request',
  'Analyze another repository': 'Analizar otro repositorio',
  '👻 Resurrected {name}': '👻 {name} resucitado',
  'No changes — {name}': 'Sin cambios — {name}',
  'Scanned — {name}': 'Escaneado — {name}',
  'Finished: {status}': 'Terminado: {status}',

  // --- Assessment card (views.js) ---
  'Eligible .js files': 'Archivos .js elegibles',
  'Files to fetch': 'Archivos a descargar',
  'Live run': 'Ejecución en vivo',
  'Available (index.html found)': 'Disponible (se encontró index.html)',
  'Not available': 'No disponible',
  '{n} minified': '{n} minificados',
  '{n} in node_modules/.git': '{n} en node_modules/.git',
  'Excluded .js': '.js excluidos',
  'Assessment of ': 'Evaluación de ',
  'Last commit {date} ({age}): ': 'Último commit {date} ({age}): ',
  '(no message)': '(sin mensaje)',
  'Archived on GitHub. ': 'Archivado en GitHub. ',
  'The repository is read-only and cannot receive pull requests. You can still resurrect it, download the result, or push it to your fork.':
    'El repositorio es de solo lectura y no puede recibir pull requests. Aun así puedes resucitarlo, descargar el resultado o subirlo a tu fork.',
  'Detected from file extensions: ': 'Detectado por las extensiones de archivo: ',
  'Folders with the most .js files (from the listing GitHub returned):': 'Carpetas con más archivos .js (según la lista que devolvió GitHub):',
  '👻 Resurrect': '👻 Resucitar',
  'This repository cannot be resurrected by this version.': 'Esta versión no puede resucitar este repositorio.',
  'Try one that works:': 'Prueba uno que funciona:',

  // --- Progress ---
  'Resurrecting…': 'Resucitando…',
  Necromancy: 'Nigromancia',
  Exorcism: 'Exorcismo',
  Transmutation: 'Transmutación',
  Resurrection: 'Resurrección',
  'Acquire the files': 'Obtener los archivos',
  'Banish unsafe innerHTML': 'Desterrar el innerHTML inseguro',
  'Modernize var and equality': 'Modernizar var y la igualdad',
  'Write the report': 'Escribir el reporte',
  pending: 'pendiente',
  running: 'en curso',
  done: 'listo',
  failed: 'falló',
  '{phase} progress': 'Progreso de {phase}',
  '{done} of {total} files': '{done} de {total} archivos',

  // --- Summary ---
  Resurrected: 'Resucitado',
  'Nothing could be changed safely': 'Nada se pudo cambiar de forma segura',
  'Nothing needed changing': 'No hacía falta cambiar nada',
  'Nothing to modernize': 'Nada que modernizar',
  '{removed} legacy patterns removed in {transformed} of {scanned} files.':
    '{removed} patrones heredados eliminados en {transformed} de {scanned} archivos.',
  'The files were scanned, but no change could be proven to keep the same behavior, so none was made.':
    'Los archivos se escanearon, pero ningún cambio se pudo demostrar que mantiene el mismo comportamiento, así que no se hizo ninguno.',
  'No var, == / != or innerHTML = pattern was found in the files that could be parsed, so nothing was changed.':
    'No se encontró ningún patrón var, == / != ni innerHTML = en los archivos que se pudieron analizar, así que no se cambió nada.',
  'GhostRepo v1 modernizes only JavaScript/web code, and none was found.': 'GhostRepo v1 solo moderniza código JavaScript/web, y no se encontró nada.',
  'Status ': 'Estado ',
  'Files scanned': 'Archivos escaneados',
  'Files transformed': 'Archivos transformados',
  'Files skipped': 'Archivos omitidos',
  'could not be parsed': 'no se pudieron analizar',
  'Lines changed': 'Líneas cambiadas',
  'Patterns removed': 'Patrones eliminados',
  "GhostRepo did not run this repository's tests. Every number above comes from the report the engine produced.":
    'GhostRepo no ejecutó las pruebas de este repositorio. Cada número de arriba sale del reporte que generó el motor.',
  'Vendor-prefixed APIs': 'APIs con prefijo de fabricante',
  'ES5 prototype assignments': 'Asignaciones a prototype de ES5',
  'Found, reported only (this version does not rewrite them)': 'Encontrados, solo reportados (esta versión no los reescribe)',
  'Left unchanged, and why': 'Sin cambios, y por qué',
  'Nothing was skipped.': 'No se omitió nada.',
  'Each of these was detected and deliberately not changed because the rewrite could not be proven to keep the same behavior.':
    'Cada uno de estos se detectó y a propósito no se cambió, porque no se pudo demostrar que la reescritura mantiene el mismo comportamiento.',
  '({reason}) · {n} site': '({reason}) · {n} sitio',
  '({reason}) · {n} sites': '({reason}) · {n} sitios',
  'Files that could not be parsed': 'Archivos que no se pudieron analizar',
  '· {n} (left exactly as they were)': '· {n} (se dejaron exactamente como estaban)',

  // --- Skip reasons ---
  'Top-level var (becomes a global property)': 'var de nivel superior (se vuelve una propiedad global)',
  'var in a for-loop initializer': 'var en el inicializador de un bucle for',
  'var captured by a closure in a loop': 'var capturada por un closure dentro de un bucle',
  'Uninitialized var inside a loop': 'var sin inicializar dentro de un bucle',
  'var declared in a switch case': 'var declarada en un case de switch',
  'var used outside its block': 'var usada fuera de su bloque',
  'var used before its declaration': 'var usada antes de su declaración',
  'var read inside its own initializer': 'var leída dentro de su propio inicializador',
  'var read by a hoisted function before it is set': 'var leída por una función elevada (hoisted) antes de asignarse',
  'var declared more than once': 'var declarada más de una vez',
  'var with the same name as a parameter': 'var con el mismo nombre que un parámetro',
  'var not directly inside a block': 'var que no está directamente dentro de un bloque',
  'Function uses eval or with': 'La función usa eval o with',
  'Destructuring declaration': 'Declaración con desestructuración',
  'Comparison with null / undefined': 'Comparación con null / undefined',
  'Operand types not known statically': 'Tipos de los operandos desconocidos en análisis estático',
  'innerHTML with a dynamic value (needs review)': 'innerHTML con un valor dinámico (requiere revisión)',
  'innerHTML with markup or an entity': 'innerHTML con marcado o una entidad',
  'innerHTML +=': 'innerHTML +=',

  // --- Code tab ---
  'Changes in {path}': 'Cambios en {path}',
  'Left unchanged: {reason}': 'Sin cambios: {reason}',
  'left unchanged: {reason}': 'sin cambios: {reason}',
  '⋯ {n} unchanged lines · show': '⋯ {n} líneas sin cambios · mostrar',
  ' Show all scanned files': ' Mostrar todos los archivos escaneados',
  unparsable: 'no analizable',
  '{n} removed': '{n} eliminados',
  '{n} skipped': '{n} omitidos',
  unchanged: 'sin cambios',
  '⬛ LEGACY': '⬛ HEREDADO',
  'no changes made': 'sin cambios',
  '👻 RESURRECTED': '👻 RESUCITADO',
  'This file was not read.': 'Este archivo no se leyó.',
  'This file was left exactly as it was.': 'Este archivo se dejó exactamente como estaba.',
  'Diff of {path}': 'Diff de {path}',
  'Download this file': 'Descargar este archivo',
  'No file was changed.': 'No se cambió ningún archivo.',

  // --- Run tab ---
  Original: 'Original',
  'Side by side': 'Lado a lado',
  'Which version to run': 'Qué versión ejecutar',
  'The preview could not be built: {message}': 'No se pudo armar la vista previa: {message}',
  'resurrected version, running': 'versión resucitada, en ejecución',
  'original version, running': 'versión original, en ejecución',
  resurrected: 'resucitada',
  original: 'original',
  'Uncaught errors — resurrected: {r} · original: {o}': 'Errores no capturados — resucitada: {r} · original: {o}',
  'The resurrected version raised errors the original did not. Review the diff before using it.':
    'La versión resucitada lanzó errores que la original no. Revisa el diff antes de usarla.',
  '▶ Run': '▶ Ejecutar',
  'Nothing from the repository runs until you press Run. The project then runs inside an isolated frame that cannot read this page or your data. Its requests and navigations are blocked, but WebRTC connections are not, so a server chosen by the project can still see your IP address.':
    'Nada del repositorio se ejecuta hasta que presionas Ejecutar. Entonces el proyecto corre dentro de un marco aislado que no puede leer esta página ni tus datos. Sus peticiones y navegaciones están bloqueadas, pero las conexiones WebRTC no, así que un servidor elegido por el proyecto aún podría ver tu dirección IP.',
  'The preview runs the project in a plain browser, with its requests blocked. Applications that depend on platform APIs (for example Firefox OS) may not run fully in either version.':
    'La vista previa ejecuta el proyecto en un navegador normal, con sus peticiones bloqueadas. Las aplicaciones que dependen de APIs de una plataforma (por ejemplo Firefox OS) pueden no funcionar del todo en ninguna de las dos versiones.',

  // --- Download tab ---
  'Resurrected project': 'Proyecto resucitado',
  'Every file of the analyzed folder, with the changed files rewritten. node_modules/ and .git/ are not included.':
    'Todos los archivos de la carpeta analizada, con los archivos modificados reescritos. No incluye node_modules/ ni .git/.',
  '⬇ Download .zip': '⬇ Descargar .zip',
  Report: 'Reporte',
  'resurrection-report.json: the measured metrics and every skipped site.': 'resurrection-report.json: las métricas medidas y cada sitio omitido.',
  '⬇ Download report': '⬇ Descargar reporte',
  Patch: 'Parche',
  'Only the changes, as a unified diff that git apply accepts.': 'Solo los cambios, como un diff unificado que acepta git apply.',
  '⬇ Download .patch': '⬇ Descargar .patch',
  'Pull request description': 'Descripción del pull request',
  '{file}: the description generated from the report, for gh pr create --body-file or to paste on GitHub.':
    '{file}: la descripción generada a partir del reporte, para gh pr create --body-file o para pegarla en GitHub.',
  '⬇ Download description': '⬇ Descargar descripción',

  // --- Pull request tab ---
  Copied: 'Copiado',
  'Copy failed': 'No se pudo copiar',
  Copy: 'Copiar',
  'your-github-username': 'tu-usuario-de-github',
  'Open pull request on GitHub ↗': 'Abrir pull request en GitHub ↗',
  'Push the branch to your fork first (the commands above do it). The link only opens GitHub\'s "Open a pull request" page with the title and description filled in; GhostRepo does not create the pull request, you do.':
    'Primero sube la rama a tu fork (los comandos de arriba lo hacen). El enlace solo abre la página "Open a pull request" de GitHub con el título y la descripción ya llenos; GhostRepo no crea el pull request, lo creas tú.',
  'That is not a valid GitHub username: 1 to 39 letters, digits or single hyphens, not starting or ending with a hyphen.':
    'Ese no es un usuario de GitHub válido: de 1 a 39 letras, dígitos o guiones sueltos, sin empezar ni terminar con guion.',
  'The description was too long for a link and is shortened there; paste the full text from the field below.':
    'La descripción era demasiado larga para un enlace y ahí va recortada; pega el texto completo desde el campo de abajo.',
  'Without the GitHub CLI': 'Sin la CLI de GitHub',
  'Your GitHub username (the owner of your fork)': 'Tu usuario de GitHub (el dueño de tu fork)',
  '{n} changed file': '{n} archivo modificado',
  '{n} changed files': '{n} archivos modificados',
  '"gh repo fork --remote" (GitHub CLI) creates your fork and makes it origin; without the GitHub CLI, fork on GitHub, run git remote add fork https://github.com/<you>/{repo}.git and push to fork instead.':
    '"gh repo fork --remote" (CLI de GitHub) crea tu fork y lo deja como origin; sin la CLI de GitHub, haz el fork en GitHub, ejecuta git remote add fork https://github.com/<tú>/{repo}.git y sube a fork en su lugar.',
  'Download the patch into an empty folder and open a shell there: the commands clone the repository into that folder and read the patch from it.':
    'Descarga el parche en una carpeta vacía y abre una terminal ahí: los comandos clonan el repositorio en esa carpeta y leen el parche desde ella.',
  'Run the commands below. They branch from the exact commit that was analyzed and push the result to your fork.':
    'Ejecuta los comandos de abajo. Crean una rama desde el commit exacto que se analizó y suben el resultado a tu fork.',
  'Your fork now holds the resurrection. Share it, keep developing it there, or download the resurrected project as a zip from the Download tab.':
    'Tu fork ya tiene la resurrección. Compártelo, sigue desarrollando ahí o descarga el proyecto resucitado como zip desde la pestaña Descargar.',
  'Download the patch and the description ({file}) into the same empty folder and open a shell there: the commands clone the repository into that folder and read both files from it.':
    'Descarga el parche y la descripción ({file}) en la misma carpeta vacía y abre una terminal ahí: los comandos clonan el repositorio en esa carpeta y leen ambos archivos desde ella.',
  'Run the commands below. They branch from the exact commit that was analyzed.':
    'Ejecuta los comandos de abajo. Crean una rama desde el commit exacto que se analizó.',
  'The last command, gh pr create, opens the pull request with the title and description. Without the GitHub CLI, use the button below instead.':
    'El último comando, gh pr create, abre el pull request con el título y la descripción. Sin la CLI de GitHub, usa el botón de abajo.',
  'This repository is archived. ': 'Este repositorio está archivado. ',
  'It is read-only on GitHub, so it cannot receive a pull request. The commands below push the resurrection to your fork instead.':
    'En GitHub es de solo lectura, así que no puede recibir un pull request. Los comandos de abajo suben la resurrección a tu fork.',
  'This kit contains only the {files}, as one atomic change. Nothing is sent anywhere: you decide when to push.':
    'Este kit contiene solo {files}, como un único cambio atómico. No se envía nada a ningún lado: tú decides cuándo subirlo.',
  '⬇ Download {file}': '⬇ Descargar {file}',
  'Open the repository on GitHub': 'Abrir el repositorio en GitHub',
  'GitHub did not report a default branch for this repository, so the one-click link is not offered. The gh pr create command still works.':
    'GitHub no informó una rama por defecto para este repositorio, así que no se ofrece el enlace de un clic. El comando gh pr create sigue funcionando.',
  'Branch name': 'Nombre de la rama',
  Commands: 'Comandos',
  'Commit message': 'Mensaje del commit',
  'Pull request title': 'Título del pull request',
};
