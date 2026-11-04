const $ = id => document.getElementById(id);
const REPO = 'https://github.com/IMONsergey/imon-design-library';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const categories = [
  ['all', 'Все паки', 'grid'], ['favorites', 'Избранное', 'bookmark'],
  ['design-system', 'Дизайн-системы', 'layers'], ['components', 'Компоненты', 'component'],
  ['motion', 'Движение', 'motion'], ['icons', 'Иконки', 'spark'],
  ['typography', 'Типографика', 'type'], ['guidelines', 'Правила', 'lines'], ['templates', 'Шаблоны', 'layout'],
];
const paths = {
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>', layers: '<path d="m12 3 10 5-10 5L2 8zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  component: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>',
  motion: '<path d="M3 12h4c6 0 4-8 10-8h4M3 19h4c6 0 4-8 10-8h4M18 1l3 3-3 3M18 8l3 3-3 3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  type: '<path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3"/>',
  lines: '<path d="M5 5h14M5 10h14M5 15h9M5 20h11"/>', layout: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M10 4v16M10 11h11"/>',
};
const state = { packs: [], latest: [], category: 'all', tag: '', query: '', view: 'grid', selected: null, selectedFilePath: '', code: '', request: null, favorites: new Set() };
const pluralRules = new Intl.PluralRules('ru');
const plural = (number, forms) => `${number} ${forms[{ one: 0, few: 1, many: 2 }[pluralRules.select(number)] ?? 2]}`;
const packCount = n => plural(n, ['пак', 'пака', 'паков']);
const assetCount = n => plural(n, ['ассет', 'ассета', 'ассетов']);
const catLabel = id => categories.find(item => item[0] === id)?.[1] || 'Пак';
const keyOf = pack => `${pack.id}@${pack.version}`;
const compareVersion = (a, b) => { const aa = a.version.split('.').map(Number), bb = b.version.split('.').map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i]; return 0; };
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = paths[name] || paths.grid; return svg; } // Static trusted icon paths only.
function safePath(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || /[\\%\s?#]/.test(value)) throw new Error('Некорректный адрес файла');
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || url.pathname !== value || !url.pathname.startsWith(prefix)) throw new Error('Некорректный адрес файла');
  return value;
}
function checkPack(pack) {
  if (!pack || !SLUG.test(pack.id) || !VERSION.test(pack.version) || typeof pack.title !== 'string' || typeof pack.summary !== 'string' || !Array.isArray(pack.tags) || !Array.isArray(pack.files) || !Array.isArray(pack.assets)) throw new Error('Некорректный формат каталога');
  const base = `${pack.id}/${pack.version}/`;
  safePath(pack.previewUrl, `/previews/${base}`);
  safePath(pack.downloadUrl, `/downloads/${pack.id}-${pack.version}.zip`);
  for (const file of pack.files) safePath(file.url, `/raw/${base}`);
  return pack;
}
function readPreferences() {
  try { const saved = JSON.parse(localStorage.getItem('imon-library-favorites') || '[]'); if (Array.isArray(saved)) state.favorites = new Set(saved.filter(value => typeof value === 'string' && SLUG.test(value))); state.view = localStorage.getItem('imon-library-view') === 'list' ? 'list' : 'grid'; } catch { /* Storage is optional. */ }
}
let toastTimer;
function toast(message) { clearTimeout(toastTimer); const host = $('pack-dialog').open ? $('pack-dialog') : $('add-dialog').open ? $('add-dialog') : document.body; const node = $('toast'); host.append(node); node.classList.toggle('dialog-toast', host !== document.body); node.textContent = message; node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; }, 2600); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch { const previousFocus = document.activeElement; const area = make('textarea', 'sr-only'); area.value = text; (document.querySelector('dialog[open]') || document.body).append(area); area.focus(); area.select(); const success = document.execCommand('copy'); area.remove(); if (previousFocus?.isConnected) previousFocus.focus(); toast(success ? 'Скопировано' : 'Не удалось скопировать. Выдели текст вручную.'); }
}
function status(title, message, retry) { const area = $('status'); area.replaceChildren(make('h3', '', title), make('p', '', message)); area.hidden = false; if (retry) { const button = make('button', 'text-button', retry.label); button.addEventListener('click', retry.action); area.append(button); } }
const mobileNav = matchMedia('(max-width: 650px)');
function setNav(open, restoreFocus = false) {
  open = open && mobileNav.matches;
  document.body.classList.toggle('nav-open', open);
  $('nav-shade').hidden = !open;
  $('menu-button').setAttribute('aria-expanded', String(open));
  $('sidebar').inert = mobileNav.matches && !open;
  $('catalog').inert = open;
  if (open) { $('sidebar').setAttribute('role', 'dialog'); $('sidebar').setAttribute('aria-modal', 'true'); $('close-nav').focus(); }
  else { $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal'); if (restoreFocus && mobileNav.matches) $('menu-button').focus(); }
}
function closeNav() { setNav(false, true); }
mobileNav.addEventListener('change', () => setNav(false));
function renderNavigation() {
  const nav = $('categories'); nav.replaceChildren();
  categories.forEach(([id, title, glyph], index) => {
    if (index === 2) nav.append(make('div', 'nav-divider'));
    const button = make('button', `nav-item${state.category === id ? ' active' : ''}`); button.dataset.category = id;
    button.setAttribute('aria-pressed', String(state.category === id));
    const count = state.latest.filter(pack => id === 'all' || (id === 'favorites' ? state.favorites.has(pack.id) : pack.category === id)).length;
    button.append(icon(glyph), make('span', '', title), make('span', 'nav-count', String(count)));
    if (id === 'favorites') button.title = 'Сохраняется только в этом браузере';
    button.addEventListener('click', () => { state.category = id; state.tag = ''; closeNav(); renderNavigation(); renderTags(); renderCatalog(); if (!mobileNav.matches) [...$('categories').querySelectorAll('button')].find(item => item.dataset.category === id)?.focus(); });
    nav.append(button);
  });
}
function renderTags() {
  const tags = [...new Set(state.latest.filter(pack => state.category === 'all' || (state.category === 'favorites' ? state.favorites.has(pack.id) : pack.category === state.category)).flatMap(pack => pack.tags))].sort((a, b) => a.localeCompare(b, 'ru')).slice(0, 16);
  $('tags').replaceChildren();
  for (const name of tags) { const button = make('button', `tag${state.tag === name ? ' active' : ''}`, name); button.setAttribute('aria-pressed', String(state.tag === name)); button.addEventListener('click', () => { state.tag = state.tag === name ? '' : name; renderTags(); renderCatalog(); [...$('tags').children].find(item => item.textContent === name)?.focus(); }); $('tags').append(button); }
}
function toggleFavorite(pack) { state.favorites.has(pack.id) ? state.favorites.delete(pack.id) : state.favorites.add(pack.id); try { localStorage.setItem('imon-library-favorites', JSON.stringify([...state.favorites])); } catch { toast('Избранное доступно до закрытия страницы'); } renderNavigation(); renderTags(); renderCatalog(); const retained = [...$('pack-grid').children].find(item => item.dataset.pack === keyOf(pack)); (retained?.querySelector('.bookmark') || $('search')).focus(); }
function card(pack) {
  const article = make('article', 'pack-card'); article.dataset.pack = keyOf(pack);
  const preview = make('div', 'card-preview'); preview.setAttribute('aria-hidden', 'true'); preview.inert = true;
  if (!pack.scripts) { const frame = make('iframe'); frame.setAttribute('sandbox', ''); frame.src = pack.previewUrl; frame.loading = 'lazy'; frame.tabIndex = -1; frame.title = `Превью ${pack.title}`; frame.referrerPolicy = 'no-referrer'; preview.append(frame); }
  else preview.append(make('div', 'preview-placeholder', 'Интерактивное превью внутри пака'));
  const body = make('div', 'card-body'), heading = make('h3', 'card-title'), open = make('button', 'card-open', pack.title);
  open.addEventListener('click', () => openRoute(pack)); heading.append(open);
  const meta = make('div', 'card-meta'); meta.append(make('span', '', `v${pack.version}`), make('span', 'meta-dot'), make('span', '', assetCount(pack.assets.length)));
  const save = make('button', `icon-button bookmark${state.favorites.has(pack.id) ? ' saved' : ''}`); save.setAttribute('aria-label', `${state.favorites.has(pack.id) ? 'Убрать из избранного' : 'В избранное'}: ${pack.title}`); save.setAttribute('aria-pressed', String(state.favorites.has(pack.id))); save.append(icon('bookmark')); save.addEventListener('click', () => toggleFavorite(pack)); meta.append(save);
  body.append(make('p', 'card-type', catLabel(pack.category)), heading, make('p', 'card-summary', pack.summary), meta); article.append(preview, body); return article;
}
function renderCatalog() {
  let packs = state.latest.filter(pack => (state.category === 'all' || (state.category === 'favorites' ? state.favorites.has(pack.id) : pack.category === state.category)) && (!state.tag || pack.tags.includes(state.tag)));
  const terms = state.query.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  packs = packs.filter(pack => { const text = [pack.title, pack.summary, pack.id, ...pack.tags, ...pack.assets.flatMap(asset => [asset.title, asset.description])].join(' ').toLocaleLowerCase('ru'); return terms.every(term => text.includes(term)); });
  packs.sort((a, b) => ($('sort').value === 'category' ? catLabel(a.category).localeCompare(catLabel(b.category), 'ru') : 0) || a.title.localeCompare(b.title, 'ru'));
  $('section-title').textContent = state.query ? 'Результаты поиска' : catLabel(state.category);
  $('result-count').textContent = String(packs.length).padStart(2, '0');
  $('clear-search').hidden = !state.query && !state.tag && state.category === 'all';
  $('pack-grid').replaceChildren(...packs.map(card)); $('pack-grid').classList.toggle('list-mode', state.view === 'list');
  for (const view of ['grid', 'list']) { $(`${view}-view`).classList.toggle('selected', state.view === view); $(`${view}-view`).setAttribute('aria-pressed', String(state.view === view)); }
  $('status').hidden = packs.length > 0;
  if (!packs.length) status(state.category === 'favorites' && !terms.length ? 'Здесь будет твое избранное' : 'Пока ничего не нашлось', state.category === 'favorites' ? 'Отметь нужный пак значком закладки. Он останется под рукой в этом браузере.' : 'Попробуй другое слово или убери часть фильтров.', { label: 'Показать все паки', action: resetFilters });
}
function resetFilters() { state.query = ''; state.tag = ''; state.category = 'all'; $('search').value = ''; renderNavigation(); renderTags(); renderCatalog(); }
function setPanel(name, focus = false) {
  for (const panel of ['preview', 'files', 'guide']) { $(`panel-${panel}`).hidden = panel !== name; $(`tab-${panel}`).setAttribute('aria-selected', String(panel === name)); $(`tab-${panel}`).tabIndex = panel === name ? 0 : -1; }
  if (name === 'files' && !state.selectedFilePath && !state.request && state.selected?.files.length) selectFile(state.selected.files.find(file => /\.(css|js|json|html)$/i.test(file.path)) || state.selected.files[0]);
  if (focus) $(`tab-${name}`).focus();
}
function renderPreview(pack) {
  $('preview-stage').replaceChildren(); $('preview-stage').classList.remove('mobile-preview'); $('preview-desktop').classList.add('active'); $('preview-mobile').classList.remove('active'); $('preview-desktop').setAttribute('aria-pressed', 'true'); $('preview-mobile').setAttribute('aria-pressed', 'false');
  const launch = () => { const frame = make('iframe', 'detail-frame'); frame.setAttribute('sandbox', pack.scripts ? 'allow-scripts' : ''); frame.title = `Интерактивное превью ${pack.title}`; frame.referrerPolicy = 'no-referrer'; frame.src = pack.previewUrl; $('preview-stage').replaceChildren(frame); };
  if (!pack.scripts) launch();
  else { const prompt = make('div', 'launch-preview'); prompt.append(make('h3', '', 'Превью использует JavaScript'), make('p', '', 'Откроется в изолированном фрейме. Доступ к данным каталога и внешней сети ограничен.')); const button = make('button', 'primary-button', 'Запустить превью'); button.addEventListener('click', launch, { once: true }); prompt.append(button); $('preview-stage').append(prompt); }
}
function renderGuide(pack) {
  $('pack-description').textContent = pack.summary; $('asset-list').replaceChildren();
  for (const asset of pack.assets) { const item = make('article', 'asset-entry'); item.append(make('h3', '', asset.title), make('small', '', asset.path), make('p', '', asset.description), make('pre', '', asset.usage)); $('asset-list').append(item); }
  const provenance = $('provenance'); provenance.replaceChildren(make('p', '', `Источник: ${pack.source?.author || 'Не указан'}${pack.source?.type === 'original' ? ' · оригинальный материал' : ''}`), make('p', '', `Лицензия: ${pack.license?.id || 'Не указана'}`), make('p', '', `Проверка: ${pack.review?.by || 'Не указана'} · ${pack.review?.date || ''}`), make('p', '', 'Условия лицензии сохраняются при скачивании и использовании. Публикация не означает свободное использование.'));
  if (pack.source?.url) { try { const source = new URL(pack.source.url); if (source.protocol === 'https:' && !source.username && !source.password) { const a = make('a', '', 'Открыть первоисточник'); a.href = source.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; provenance.append(a); } } catch { /* Invalid provenance is not linked. */ } }
}
async function selectFile(file) {
  if (!state.selected) return; state.selectedFilePath = file.path; state.request?.abort(); const controller = new AbortController(); state.request = controller; state.code = ''; $('copy-code').disabled = true; $('file-name').textContent = file.path; $('code-content').textContent = 'Загружаем файл…';
  for (const item of $('file-list').children) { item.classList.toggle('active', item.dataset.path === file.path); item.setAttribute('aria-pressed', String(item.dataset.path === file.path)); }
  $('file-info').textContent = `${new Intl.NumberFormat('ru').format(file.size)} байт · SHA-256 ${file.sha256}`;
  if (!/\.(?:html?|css|m?js|json|svg|txt|md)$/i.test(file.path) || file.size > 524288) { $('code-content').textContent = file.size > 524288 ? 'Большой файл. Скачай пак, чтобы открыть его целиком.' : 'Бинарный файл. Оригинал находится в ZIP-архиве пака.'; state.request = null; return; }
  const selectedKey = keyOf(state.selected);
  try { const response = await fetch(safePath(file.url, `/raw/${state.selected.id}/${state.selected.version}/`), { signal: controller.signal }); if (!response.ok) throw new Error('Файл недоступен'); const text = await response.text(); if (controller.signal.aborted || !state.selected || selectedKey !== keyOf(state.selected)) return; if (text.length > 524288) throw new Error('Файл слишком большой для просмотра'); state.code = text; $('code-content').textContent = text; $('copy-code').disabled = false; }
  catch (error) { if (!controller.signal.aborted) $('code-content').textContent = `Не удалось открыть файл. ${error.message}. Попробуй выбрать его еще раз или скачать пак.`; }
  finally { if (state.request === controller) state.request = null; }
}
function openPack(pack) {
  setNav(false);
  state.request?.abort(); state.request = null; state.selected = pack; state.selectedFilePath = ''; state.code = '';
  $('pack-title').textContent = pack.title; $('pack-category').textContent = catLabel(pack.category); $('download-pack').href = pack.downloadUrl; $('download-pack').download = `${pack.id}-${pack.version}.zip`;
  $('pack-meta').textContent = `${assetCount(pack.assets.length)} · ${plural(pack.files.length, ['файл', 'файла', 'файлов'])} · v${pack.version}`;
  const versions = state.packs.filter(item => item.id === pack.id).sort(compareVersion); $('version-select').replaceChildren(...versions.map(item => { const option = make('option', '', `v${item.version}`); option.value = item.version; return option; })); $('version-select').value = pack.version;
  $('file-list').replaceChildren(...pack.files.map(file => { const button = make('button', 'file-button', file.path); button.dataset.path = file.path; button.title = file.path; button.addEventListener('click', () => selectFile(file)); return button; }));
  $('file-name').textContent = ''; $('code-content').textContent = ''; $('file-info').textContent = ''; $('copy-code').disabled = true;
  renderPreview(pack); renderGuide(pack); setPanel('preview');
  if (!$('pack-dialog').open) { $('pack-dialog').showModal(); document.body.classList.add('dialog-open'); }
}
function openRoute(pack) { history.pushState(null, '', `#pack=${keyOf(pack)}`); openPack(pack); }
function syncHash() { const key = new URLSearchParams(location.hash.slice(1)).get('pack'); if (!key) { if ($('pack-dialog').open) $('pack-dialog').close(); return; } const pack = state.packs.find(item => keyOf(item) === key); if (pack) openPack(pack); else { if ($('pack-dialog').open) $('pack-dialog').close(); history.replaceState(null, '', location.pathname + location.search); toast('Эта версия пака не найдена'); } }
function contextText(pack) { return [`I’MON Design Library: ${REPO}`, `Пак: ${pack.id}`, `Версия: ${pack.version}`, `Ссылка: ${location.origin}/#pack=${keyOf(pack)}`, `Исходники: packs/${pack.id}/${pack.version}/`, `Манифест: ${location.origin}${pack.manifestUrl}`, `Лицензия: ${pack.license.id}`, '', 'Прочитай AGENTS.md, manifest.json и README пака. Используй только выбранный пак, не смешивай его стили с другими системами. Проверь условия лицензии и зависимости перед интеграцией.', '', 'Ассеты:', ...pack.assets.map(asset => `- ${asset.title}: ${asset.path}`)].join('\n'); }

$('search').addEventListener('input', event => { state.query = event.target.value; renderCatalog(); });
$('clear-search').addEventListener('click', resetFilters); $('sort').addEventListener('change', renderCatalog);
for (const view of ['grid', 'list']) $(`${view}-view`).addEventListener('click', () => { state.view = view; try { localStorage.setItem('imon-library-view', view); } catch {} renderCatalog(); });
$('menu-button').addEventListener('click', () => setNav(!document.body.classList.contains('nav-open'))); $('nav-shade').addEventListener('click', closeNav); $('close-nav').addEventListener('click', closeNav);
$('close-pack').addEventListener('click', () => $('pack-dialog').close());
$('pack-dialog').addEventListener('close', () => { state.request?.abort(); state.request = null; state.selected = null; state.selectedFilePath = ''; state.code = ''; $('preview-stage').replaceChildren(); document.body.classList.remove('dialog-open'); if (new URLSearchParams(location.hash.slice(1)).has('pack')) history.replaceState(null, '', location.pathname + location.search); });
$('version-select').addEventListener('change', event => { const pack = state.packs.find(item => item.id === state.selected.id && item.version === event.target.value); if (pack) openRoute(pack); });
for (const name of ['preview', 'files', 'guide']) $(`tab-${name}`).addEventListener('click', () => setPanel(name));
document.querySelector('.detail-tabs').addEventListener('keydown', event => { const tabs = ['preview', 'files', 'guide']; let index = tabs.findIndex(name => $(`tab-${name}`) === document.activeElement); if (index < 0 || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setPanel(tabs[index], true); });
for (const size of ['desktop', 'mobile']) $(`preview-${size}`).addEventListener('click', () => { $('preview-stage').classList.toggle('mobile-preview', size === 'mobile'); for (const other of ['desktop', 'mobile']) { $(`preview-${other}`).classList.toggle('active', size === other); $(`preview-${other}`).setAttribute('aria-pressed', String(size === other)); } });
$('copy-code').addEventListener('click', () => { if (state.code) copy(state.code); }); $('copy-context').addEventListener('click', () => { if (state.selected) copy(contextText(state.selected)); });
$('how-to').addEventListener('click', () => { closeNav(); $('add-dialog').showModal(); document.body.classList.add('dialog-open'); }); $('close-add').addEventListener('click', () => $('add-dialog').close()); $('add-dialog').addEventListener('close', () => document.body.classList.remove('dialog-open'));
$('copy-prompt').addEventListener('click', () => copy(`Добавь этот материал в I’MON Design Library (${REPO}). Создай отдельный пак, проверь источник и права, сделай превью и инструкцию. Не смешивай его с другими дизайн-системами. Сначала прочитай AGENTS.md и docs/ADDING_ASSETS.md. Публикуй только материалы, которые разрешено раскрывать.`));
for (const dialog of [$('pack-dialog'), $('add-dialog')]) dialog.addEventListener('click', event => { const bounds = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close(); });
window.addEventListener('hashchange', syncHash);
document.addEventListener('keydown', event => {
  if (document.body.classList.contains('nav-open')) {
    if (event.key === 'Escape') { event.preventDefault(); closeNav(); }
    if (event.key === 'Tab') { const items = [...$('sidebar').querySelectorAll('a[href],button:not(:disabled)')].filter(item => item.getClientRects().length); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    return;
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (event.key === '/' && !typing && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); }
});

async function loadCatalog() {
  try { const response = await fetch('/api/catalog.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('Каталог временно недоступен'); const catalog = await response.json(); if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packs) || catalog.packs.length > 500) throw new Error('Неподдерживаемый формат'); state.packs = catalog.packs.map(checkPack); const latest = new Map(); for (const pack of [...state.packs].sort(compareVersion)) if (!latest.has(pack.id)) latest.set(pack.id, pack); state.latest = [...latest.values()]; $('totals').textContent = `${packCount(state.latest.length)} · ${assetCount(state.latest.reduce((sum, pack) => sum + pack.assets.length, 0))}`; renderNavigation(); renderTags(); renderCatalog(); syncHash(); }
  catch { $('totals').textContent = 'Не удалось загрузить'; status('Каталог не загрузился', 'Проверь соединение и попробуй еще раз. Материалы по-прежнему доступны в репозитории.', { label: 'Попробовать снова', action: loadCatalog }); }
}
readPreferences(); renderNavigation(); setNav(false); loadCatalog();
