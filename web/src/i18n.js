// GhostRepo · i18n — static UI translations (EN / ES).
// Translates the static HTML strings marked with data-i18n. The views that main.js
// builds at runtime are translated by lang.js; applyLang switches both.
//
// A string may mark inline code as <code>…</code> and the glowing word of the
// headline as <glow>…</glow>. Those become DOM nodes (never innerHTML), so
// switching language keeps the formatting the page was written with.

import { setLang } from './lang.js';

export const translations = {
  en: {
    'nav.howItWorks': 'How it works',
    'nav.whatItCanRaise': 'What it can raise',
    'nav.sourceOnGitHub': 'Source on GitHub',

    'hero.headline': 'Raise your dead <glow>JavaScript</glow> from the grave.',
    'hero.lead':
      'Paste a GitHub link to an abandoned web app. GhostRepo checks whether it can rise, rewrites legacy patterns with codemods that only touch what is provably safe, and runs the original and the resurrected app side by side.',
    'hero.pill1': 'JavaScript',
    'hero.pill2': 'HTML pages and their scripts',
    'hero.pill3': 'ES5 and jQuery-era web apps',
    'hero.notJava':
      'JavaScript, not Java: they are different languages. Repositories in other languages are detected and you are told why before any work is done.',

    'form.label': 'Link to a dead GitHub repository',
    'form.placeholder': 'https://github.com/owner/repo',
    'form.analyze': 'Analyze',
    'form.hint': 'Public repositories only. Nothing is downloaded or run until you say so.',
    'form.subfolderSummary': 'Only one folder of the repository?',
    'form.subfolderLabel': 'Subfolder',
    'form.tryOne': 'Try one:',

    'tomb.caption': 'What a resurrection looks like',
    'tomb.note':
      'Same behavior, modern syntax. Anything that cannot be proven safe is left as it was and listed with the reason.',

    'ritual.title': 'The ritual, in four phases',
    'ritual.phase1.name': 'Necromancy',
    'ritual.phase1.desc':
      'Reads the repository from GitHub and finds every JavaScript file worth reviving. Python, Java or PHP projects are told so here, before anything else happens.',
    'ritual.phase2.name': 'Exorcism',
    'ritual.phase2.desc':
      "Replaces <code>innerHTML = 'plain text'</code> with <code>textContent</code>. Dynamic HTML is flagged for a human, never rewritten blindly.",
    'ritual.phase3.name': 'Transmutation',
    'ritual.phase3.desc':
      'Turns <code>var</code> into <code>const</code> or <code>let</code>, and <code>==</code> into <code>===</code> when both sides are known to have the same type.',
    'ritual.phase4.name': 'Resurrection',
    'ritual.phase4.desc':
      'Shows every change next to the original, runs both versions, and gives you a patch and a ready-to-paste pull request.',

    'scope.title': 'What it can raise',
    'scope.yes.title': 'Rises today',
    'scope.yes.item1': 'JavaScript web apps: <code>.js</code> files and the HTML pages that load them',
    'scope.yes.item2': 'ES5 code, jQuery-era sites, old browser and Firefox OS apps',
    'scope.yes.item3': 'A whole repository, or just one folder of it',
    'scope.no.title': 'Stays buried, for now',
    'scope.no.item1': 'Java, Python, PHP, C#, Ruby and other languages: detected and explained, not modified',
    'scope.no.item2': 'Private repositories',
    'scope.no.item3': "Running the repository's own tests",

    'vow.title': 'The Zero Breaking Logic vow',
    'vow.item1.title': 'Provably safe or untouched.',
    'vow.item1.desc': 'A rewrite is applied only when the syntax proves the behavior stays the same.',
    'vow.item2.title': 'Nothing hidden.',
    'vow.item2.desc': 'Every skipped site is listed with its reason and line.',
    'vow.item3.title': 'Measured, not guessed.',
    'vow.item3.desc': 'Every number comes from the actual code before and after.',

    'footer.privacy':
      'Everything runs in your browser; no code is sent to any server of ours. Public GitHub repositories only. GhostRepo does not run a repository\u2019s own tests, so review the diff before you merge anything.',
    'footer.license': 'GhostRepo \u00b7 MIT License \u00b7 Built with Kiro for the Kiroween hackathon.',
  },

  es: {
    'nav.howItWorks': 'Cómo funciona',
    'nav.whatItCanRaise': 'Qué puede revivir',
    'nav.sourceOnGitHub': 'Código en GitHub',

    'hero.headline': 'Levanta tu <glow>JavaScript</glow> muerto de la tumba.',
    'hero.lead':
      'Pega un enlace de GitHub a una web app abandonada. GhostRepo comprueba si puede resucitar, reescribe patrones heredados con codemods que solo tocan lo que es demostrablemente seguro, y ejecuta la app original y la resucitada una al lado de la otra.',
    'hero.pill1': 'JavaScript',
    'hero.pill2': 'Páginas HTML y sus scripts',
    'hero.pill3': 'Web apps de la era ES5 y jQuery',
    'hero.notJava':
      'JavaScript, no Java: son lenguajes distintos. Los repositorios en otros lenguajes son detectados y se te explica el motivo antes de hacer cualquier cambio.',

    'form.label': 'Enlace a un repositorio muerto en GitHub',
    'form.placeholder': 'https://github.com/owner/repo',
    'form.analyze': 'Analizar',
    'form.hint': 'Solo repositorios públicos. No se descarga ni ejecuta nada hasta que tú lo indiques.',
    'form.subfolderSummary': '¿Solo una carpeta del repositorio?',
    'form.subfolderLabel': 'Subcarpeta',
    'form.tryOne': 'Prueba uno:',

    'tomb.caption': 'Así se ve una resurrección',
    'tomb.note':
      'El mismo comportamiento, sintaxis moderna. Todo lo que no se puede demostrar como seguro se deja tal cual y se lista con su motivo.',

    'ritual.title': 'El ritual, en cuatro fases',
    'ritual.phase1.name': 'Nigromancia',
    'ritual.phase1.desc':
      'Lee el repositorio de GitHub y encuentra cada archivo JavaScript que vale la pena revivir. Los proyectos en Python, Java o PHP son notificados aquí, antes de que ocurra cualquier otra cosa.',
    'ritual.phase2.name': 'Exorcismo',
    'ritual.phase2.desc':
      "Reemplaza <code>innerHTML = 'texto plano'</code> por <code>textContent</code>. El HTML dinámico se marca para revisión humana, nunca se reescribe a ciegas.",
    'ritual.phase3.name': 'Transmutación',
    'ritual.phase3.desc':
      'Convierte <code>var</code> en <code>const</code> o <code>let</code>, y <code>==</code> en <code>===</code> cuando se sabe que ambos lados tienen el mismo tipo.',
    'ritual.phase4.name': 'Resurrección',
    'ritual.phase4.desc':
      'Muestra cada cambio junto al original, ejecuta ambas versiones y te entrega un parche y un pull request listo para pegar.',

    'scope.title': 'Qué puede revivir',
    'scope.yes.title': 'Resucita hoy',
    'scope.yes.item1': 'Web apps en JavaScript: archivos <code>.js</code> y las páginas HTML que los cargan',
    'scope.yes.item2': 'Código ES5, sitios de la era jQuery, apps antiguas de navegador y Firefox OS',
    'scope.yes.item3': 'Un repositorio completo, o solo una carpeta de él',
    'scope.no.title': 'Se queda enterrado, por ahora',
    'scope.no.item1': 'Java, Python, PHP, C#, Ruby y otros lenguajes: detectados y explicados, sin modificar',
    'scope.no.item2': 'Repositorios privados',
    'scope.no.item3': 'Ejecutar las pruebas propias del repositorio',

    'vow.title': 'El voto Zero Breaking Logic',
    'vow.item1.title': 'Demostrablemente seguro o sin tocar.',
    'vow.item1.desc': 'Una reescritura solo se aplica cuando la sintaxis demuestra que el comportamiento se mantiene igual.',
    'vow.item2.title': 'Nada oculto.',
    'vow.item2.desc': 'Cada sitio omitido se lista con su motivo y número de línea.',
    'vow.item3.title': 'Medido, no inventado.',
    'vow.item3.desc': 'Cada número proviene del código real antes y después de los cambios.',

    'footer.privacy':
      'Todo se ejecuta en tu navegador; no se envía ningún código a ningún servidor nuestro. Solo repositorios públicos de GitHub. GhostRepo no ejecuta las pruebas propias del repositorio, así que revisa el diff antes de fusionar cualquier cosa.',
    'footer.license': 'GhostRepo \u00b7 Licencia MIT \u00b7 Creado con Kiro para el hackathon Kiroween.',
  },
};

const INLINE = /<(code|glow)>([^<]*)<\/\1>/g;

/** Fill el with text, turning <code>…</code> and <glow>…</glow> into elements. */
function setRichText(el, text) {
  el.textContent = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    const node = document.createElement(m[1] === 'code' ? 'code' : 'span');
    if (m[1] === 'glow') node.className = 'glow';
    node.textContent = m[2];
    el.append(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

/**
 * Apply the given language to all [data-i18n] elements on the page.
 * Also updates placeholders on inputs with [data-i18n-placeholder],
 * updates aria-pressed on .lang-btn buttons, and persists the choice.
 *
 * @param {'en'|'es'} lang
 */
export function applyLang(lang) {
  const dict = translations[lang] || translations.en;

  // Update text content for each marked element.
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key] != null) {
      setRichText(el, dict[key]);
    }
  }

  // Update placeholder attributes for inputs.
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && dict[key] != null) {
      el.placeholder = dict[key];
    }
  }

  // Sync aria-pressed on language buttons.
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.setAttribute('aria-pressed', btn.id === `btn-${lang}` ? 'true' : 'false');
  }

  document.documentElement.lang = lang === 'es' ? 'es' : 'en';
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  // Last, so the runtime views redraw after the static page is translated.
  setLang(lang);
}

// Apply saved (or default) language immediately on module load.
let saved = null;
try {
  saved = localStorage.getItem('lang');
} catch {
  /* storage blocked */
}
applyLang(saved === 'es' ? 'es' : 'en');
