import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import { validatePack } from './catalog.mjs';
import { folderHref, latestPacks, packHref, parseRoute, resolveRoute } from './routing.mjs';
import { BrandMark } from './brand.jsx';
import { LivePreview } from './live-preview.jsx';
import { Button, IconButton, Popover, SegmentedControl, Select, Tabs, TextField, Theme, Tooltip } from '@radix-ui/themes';
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowTopRightIcon, BookmarkFilledIcon, BookmarkIcon, CheckIcon, CopyIcon, Cross2Icon, DesktopIcon, DownloadIcon, FileTextIcon, GridIcon, MixerHorizontalIcon, MoonIcon, RowsIcon, MagnifyingGlassIcon, SunIcon } from '@radix-ui/react-icons';
import '@radix-ui/themes/styles.css';
import '@fontsource-variable/inter';
import './styles.css';

const REPOSITORY = 'https://github.com/IMONsergey/imon-design-library';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categoryList = [['design-system', 'Дизайн-системы'], ['components', 'Компоненты'], ['motion', 'Движение'], ['icons', 'Иконки'], ['typography', 'Типографика'], ['guidelines', 'Правила'], ['templates', 'Шаблоны']];
const categoryName = id => categoryList.find(item => item[0] === id)?.[1] || 'Материалы';
const pluralRules = new Intl.PluralRules('ru');
const plural = (count, forms) => count + ' ' + forms[({ one: 0, few: 1, many: 2 }[pluralRules.select(count)] ?? 2)];
const assetCount = count => plural(count, ['ассет', 'ассета', 'ассетов']);
const packKey = pack => pack.id + '@' + pack.version;
const termsFor = value => value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
const matchesTerms = (terms, values) => { const text = values.join(' ').toLocaleLowerCase('ru'); return terms.every(term => text.includes(term)); };
const readSetting = (name, fallback) => { try { return localStorage.getItem(name) ?? fallback; } catch { return fallback; } };
function saveSetting(name, value) { try { localStorage.setItem(name, value); return true; } catch { return false; } }
function readFavorites() { try { const values = JSON.parse(readSetting('imon-library-favorites', '[]')); return new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string' && SLUG.test(value)) : []); } catch { return new Set(); } }
function bytes(size) { return size < 1024 ? size + ' Б' : size < 1048576 ? (size / 1024).toLocaleString('ru', { maximumFractionDigits: 1 }) + ' КБ' : (size / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 }) + ' МБ'; }
const readRoute = () => parseRoute(location.hash);
function safeSource(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function fileFor(pack, asset) { return pack.files.find(file => file.path === asset.path); }
function previewFor(pack, asset) {
  const prefix = '/previews/' + pack.id + '/' + pack.version + '/';
  if (typeof asset.previewUrl === 'string' && pack.files.some(file => prefix + file.path === asset.previewUrl)) return asset.previewUrl;
  return !asset.previewUrl && pack.assets.length === 1 ? pack.previewUrl : null;
}
const nonce = document.querySelector('meta[name="csp-nonce"]')?.content;
if (nonce && nonce !== '__IMON_CSP_NONCE__') setNonce(nonce);

function useAppearance() {
  const [choice, setChoice] = useState(() => { const saved = readSetting('imon-library-theme', 'system'); return ['light', 'dark', 'system'].includes(saved) ? saved : 'system'; });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const appearance = choice === 'system' ? systemDark ? 'dark' : 'light' : choice;
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const changed = event => setSystemDark(event.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.documentElement.style.colorScheme = appearance;
    document.documentElement.classList.toggle('dark', appearance === 'dark');
    document.documentElement.classList.toggle('light', appearance === 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#111111' : '#fafafa');
  }, [appearance]);
  const choose = value => { if (['light', 'dark', 'system'].includes(value)) { saveSetting('imon-library-theme', value); setChoice(value); } };
  return { appearance, choice, choose };
}
function ThemeSwitch({ value, onChange }) {
  return <SegmentedControl.Root className="theme-switch" aria-label="Тема оформления" size="1" value={value} onValueChange={onChange}>
    <SegmentedControl.Item value="light" aria-label="Светлая тема" title="Светлая"><SunIcon /></SegmentedControl.Item>
    <SegmentedControl.Item value="dark" aria-label="Темная тема" title="Темная"><MoonIcon /></SegmentedControl.Item>
    <SegmentedControl.Item value="system" aria-label="Системная тема" title="Как на устройстве"><DesktopIcon /></SegmentedControl.Item>
  </SegmentedControl.Root>;
}
function Toast({ message }) { return <div className="toast-region" aria-live="polite" aria-atomic="true">{message && <div className="toast" role="status"><CheckIcon /><span>{message}</span></div>}</div>; }
function FolderSymbol() { return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 3.25h3.1l1.3 1.5h6.6v7a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>; }
function PageLink({ href, navigate, beforeNavigate, children, ...props }) {
  return <a {...props} href={href || '/'} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); beforeNavigate?.(); navigate(href);
  }}>{children}</a>;
}
function Breadcrumbs({ items, navigate }) {
  if (!items.length) return null;
  return <nav className="breadcrumbs" aria-label="Хлебные крошки"><ol>{items.map((item, index) => <li key={index}>
    {index > 0 && <span className="breadcrumb-divider" aria-hidden="true">/</span>}
    {item.href === undefined ? <span aria-current="page">{item.title}</span> : <PageLink href={item.href} navigate={navigate}>{item.title}</PageLink>}
  </li>)}</ol></nav>;
}
function SearchField({ value, onChange, inputRef, collection = false }) {
  const label = collection ? 'Поиск по коллекции' : 'Поиск по библиотеке';
  return <TextField.Root className="catalog-search" ref={inputRef} aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} size="3">
    <TextField.Slot><MagnifyingGlassIcon /></TextField.Slot>
    <TextField.Slot>{value ? <IconButton variant="ghost" size="1" color="gray" aria-label="Очистить поиск" onClick={() => { onChange(''); inputRef.current?.focus(); }}><Cross2Icon /></IconButton> : <kbd>/</kbd>}</TextField.Slot>
  </TextField.Root>;
}
function FavoriteButton({ pack, saved, onFavorite, className = 'bookmark' }) {
  return <Tooltip content={saved ? 'Убрать из избранного' : 'Сохранить коллекцию'}><IconButton className={className + (saved ? ' is-saved' : '')} variant="ghost" color="gray" size="2" aria-label={(saved ? 'Убрать из избранного: ' : 'В избранное: ') + pack.title} aria-pressed={saved} onClick={() => onFavorite(pack.id)}>{saved ? <BookmarkFilledIcon /> : <BookmarkIcon />}</IconButton></Tooltip>;
}
const PackCard = memo(function PackCard({ pack, saved, navigate, onFavorite }) {
  return <article className="pack-card" data-pack={packKey(pack)}>
    <PageLink className="pack-link" href={packHref(pack)} navigate={navigate}>
      <div className="pack-cover"><LivePreview src={pack.previewUrl} title={'Превью ' + pack.title} scripts={pack.scripts} autoplay={pack.autoplay === true} interactive={false} /></div>
      <div className="pack-body"><h2 className="pack-title">{pack.title}</h2><div className="pack-meta"><span>{assetCount(pack.assets.length)}</span><span className="open-hint"><ArrowTopRightIcon /></span></div></div>
    </PageLink>
    <FavoriteButton pack={pack} saved={saved} onFavorite={onFavorite} />
  </article>;
});
function FilterMenu({ category, setCategory, tag, setTag, packs, clear }) {
  const categories = categoryList.filter(([id]) => packs.some(pack => pack.category === id));
  const tags = useMemo(() => [...new Set(packs.filter(pack => category === 'all' || pack.category === category).flatMap(pack => pack.tags))].sort((a, b) => a.localeCompare(b, 'ru')), [category, packs]);
  const count = Number(category !== 'all') + Number(!!tag);
  return <Popover.Root><Popover.Trigger><Button className="filter-button" variant="surface" color="gray" size="2"><MixerHorizontalIcon />Фильтры{count > 0 && <span className="filter-count">{count}</span>}</Button></Popover.Trigger><Popover.Content className="filter-popover" width="300" align="end">
    <div className="popover-heading"><strong>Фильтры</strong>{count > 0 && <Button variant="ghost" color="gray" size="1" onClick={clear}>Сбросить</Button>}</div>
    <label className="field-label" id="category-label">Категория</label><Select.Root value={category} onValueChange={value => { setCategory(value); setTag(''); }}><Select.Trigger aria-labelledby="category-label" className="category-select" /><Select.Content position="popper"><Select.Item value="all">Все категории</Select.Item>{categories.map(([id, title]) => <Select.Item key={id} value={id}>{title} · {packs.filter(pack => pack.category === id).length}</Select.Item>)}</Select.Content></Select.Root>
    <span className="field-label tag-label">Теги</span><div className="filter-tags">{tags.length ? tags.slice(0, 40).map(name => <button className={'filter-tag' + (tag === name ? ' is-active' : '')} aria-pressed={tag === name} onClick={() => setTag(tag === name ? '' : name)} key={name}>{name}</button>) : <p className="muted-copy">В этой категории пока нет тегов.</p>}</div>
  </Popover.Content></Popover.Root>;
}

function FileBrowser({ pack, files = pack.files, notify }) {
  const [filePath, setFilePath] = useState(() => files.find(file => pack.assets.some(asset => asset.path === file.path))?.path || files[0]?.path || '');
  const [state, setState] = useState({ status: 'idle', url: '', text: '' });
  const [retry, setRetry] = useState(0);
  const file = files.find(item => item.path === filePath) || files[0];
  useEffect(() => {
    if (!file) return;
    if (!/\.(?:html?|css|m?js|json|svg|txt|md)$/i.test(file.path) || file.size > 524288) { setState({ status: 'binary', url: file.url, text: '' }); return; }
    const controller = new AbortController();
    setState({ status: 'loading', url: file.url, text: '' });
    fetch(file.url, { signal: controller.signal, redirect: 'error' }).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.text(); }).then(text => {
      if (controller.signal.aborted) return;
      if (text.length > 524288) throw new Error('Too large');
      setState({ status: 'ready', url: file.url, text });
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error', url: file.url, text: '' }); });
    return () => controller.abort();
  }, [file?.url, retry]);
  const current = state.url === file?.url ? state : { status: 'loading', text: '' };
  const lines = current.status === 'ready' ? current.text.split('\n').length : 0;
  return <div className={'files-panel' + (files.length === 1 ? ' single-file' : '')}>
    {files.length > 1 && <nav className="file-nav" aria-label="Файлы коллекции"><div className="file-nav-heading">Файлы <span>{files.length}</span></div>{files.map(item => <button key={item.path} className={'file-item' + (file?.path === item.path ? ' is-active' : '')} title={item.path} aria-pressed={file?.path === item.path} onClick={() => setFilePath(item.path)}><FileTextIcon /><span>{item.path}</span><small>{bytes(item.size)}</small></button>)}</nav>}
    <div className="code-column"><div className="code-header"><span className="code-filename">{file?.path || 'Файл не выбран'}</span><div className="code-actions">
      {file && <Tooltip content="Скачать файл"><IconButton asChild variant="ghost" color="gray" size="1"><a href={file.url} download={file.path.split('/').at(-1)} aria-label="Скачать файл"><ArrowDownIcon /></a></IconButton></Tooltip>}
      <Button variant="surface" color="gray" size="1" disabled={current.status !== 'ready'} onClick={() => notify(current.text, true)}><CopyIcon />Копировать</Button>
    </div></div>
    {current.status === 'ready' ? <div className="code-scroll" tabIndex={0} aria-label={'Код файла ' + file.path}><pre className="code-lines" aria-hidden="true">{Array.from({ length: Math.min(lines, 10000) }, (_, index) => index + 1).join('\n')}</pre><pre className="code-source"><code>{current.text}</code></pre></div>
      : <div className="code-placeholder">{current.status === 'loading' ? 'Загружаем файл' : current.status === 'error' ? <><p>Не удалось открыть файл.</p><Button size="1" variant="outline" onClick={() => setRetry(value => value + 1)}>Повторить</Button></> : current.status === 'binary' ? <><FileTextIcon /><p>Этот файл удобнее открыть после скачивания.</p>{file && <Button asChild variant="surface" size="2"><a href={file.url} download>Скачать файл</a></Button>}</> : 'Файл не выбран'}</div>}
    <div className="code-meta"><span>{file ? bytes(file.size) : ''}{lines > 0 ? ' · ' + plural(lines, ['строка', 'строки', 'строк']) : ''}</span></div></div>
  </div>;
}
function PackGuide({ pack }) {
  const licenseFile = pack.files.find(file => file.path === pack.license.file);
  const sourceUrl = safeSource(pack.source?.url);
  return <section className="pack-guide" aria-label="Источник и лицензия">
    <dl className="provenance-facts">
      {pack.source?.author && <div><dt>Автор</dt><dd>{pack.source.author}</dd></div>}
      <div><dt>Лицензия</dt><dd>{licenseFile ? <a href={licenseFile.url} download={licenseFile.path.split('/').at(-1)}>{pack.license.id}</a> : pack.license.id}</dd></div>
      {sourceUrl && <div><dt>Источник</dt><dd><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Открыть <ArrowTopRightIcon /></a></dd></div>}
    </dl>
  </section>;
}
const AssetCard = memo(function AssetCard({ pack, asset, navigate }) {
  const file = fileFor(pack, asset);
  return <article className="asset-card" data-asset={asset.id}>
    <div className="asset-preview"><LivePreview src={previewFor(pack, asset)} title={pack.title + ' / ' + asset.title} scripts={pack.scripts} autoplay={pack.autoplay === true} /></div>
    <div className="asset-card-body"><h2><PageLink className="asset-link" href={packHref(pack, asset)} navigate={navigate}>{asset.title}<ArrowTopRightIcon aria-hidden="true" /></PageLink></h2>
      <div className="asset-card-actions">
        {file && <a className="asset-download" href={file.url} download={file.path.split('/').at(-1)} aria-label={'Скачать ассет: ' + asset.title}><DownloadIcon />Скачать</a>}
      </div>
    </div>
  </article>;
});
function CollectionPage({ pack, navigate, notify, query, setQuery, searchRef }) {
  const [tab, setTab] = useState('assets');
  const terms = termsFor(query);
  const assets = pack.assets.filter(asset => matchesTerms(terms, [asset.id, asset.title, asset.description, asset.usage]));
  return <section className="collection-page" data-pack={packKey(pack)}>
    <Tabs.Root className="collection-tabs-root" value={tab} onValueChange={setTab}>
      <div className="page-tabs-row"><Tabs.List className="page-tabs" aria-label="Содержимое коллекции"><Tabs.Trigger value="assets">Ассеты</Tabs.Trigger><Tabs.Trigger value="files">Файлы</Tabs.Trigger></Tabs.List>
      </div>
      <Tabs.Content value="assets" className="collection-assets">
        <div className="asset-toolbar"><SearchField value={query} onChange={setQuery} inputRef={searchRef} collection /><span className="asset-results-count" aria-live="polite">{assetCount(assets.length)}</span></div>
        {assets.length ? <div className="asset-grid">{assets.map(asset => <AssetCard key={asset.id} pack={pack} asset={asset} navigate={navigate} />)}</div>
          : <div className="empty-state"><h2>Ничего не нашлось</h2><p>Попробуй другое название или очисти поиск.</p><Button variant="surface" onClick={() => setQuery('')}>Сбросить поиск</Button></div>}
      </Tabs.Content>
      <Tabs.Content value="files" className="collection-files"><FileBrowser pack={pack} notify={notify} /><PackGuide pack={pack} /></Tabs.Content>
    </Tabs.Root>
  </section>;
}
function AssetPage({ pack, asset, navigate, notify }) {
  const file = fileFor(pack, asset), index = pack.assets.findIndex(item => item.id === asset.id);
  return <section className="asset-page" data-pack={packKey(pack)} data-asset={asset.id}>
    <div className="asset-detail-grid">
      <div className="asset-visual-column"><div className="asset-detail-preview"><LivePreview src={previewFor(pack, asset)} title={pack.title + ' / ' + asset.title} scripts={pack.scripts} autoplay={pack.autoplay === true} /></div>
        <nav className="asset-pagination" aria-label="Другие ассеты">{index > 0 ? <PageLink href={packHref(pack, pack.assets[index - 1])} navigate={navigate}><ArrowLeftIcon aria-hidden="true" />{pack.assets[index - 1].title}</PageLink> : <span />}
          <span>{index + 1} / {pack.assets.length}</span>{index < pack.assets.length - 1 ? <PageLink href={packHref(pack, pack.assets[index + 1])} navigate={navigate}>{pack.assets[index + 1].title}<ArrowRightIcon aria-hidden="true" /></PageLink> : <span />}
        </nav>
      </div>
      <Tabs.Root className="asset-reference" defaultValue="source"><Tabs.List className="page-tabs" aria-label="Данные ассета"><Tabs.Trigger value="source">Исходник</Tabs.Trigger><Tabs.Trigger value="usage">Инструкция</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="usage" className="asset-usage"><pre className="usage-text">{asset.usage}</pre><PackGuide pack={pack} />
          <a className="collection-archive-link text-link" href={pack.downloadUrl} download={pack.id + '-' + pack.version + '.zip'}>Скачать коллекцию <ArrowDownIcon /></a>
        </Tabs.Content>
        <Tabs.Content value="source" className="asset-source">{file ? <FileBrowser pack={pack} files={[file]} notify={notify} /> : <p className="muted-copy">Исходник недоступен.</p>}</Tabs.Content>
      </Tabs.Root>
    </div>
  </section>;
}
function App() {
  const { appearance, choice, choose } = useAppearance();
  const [catalog, setCatalog] = useState([]), [load, setLoad] = useState('loading'), [attempt, setAttempt] = useState(0);
  const [requestedRoute, setRoute] = useState(readRoute), [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [tag, setTag] = useState(''), [sort, setSort] = useState('title');
  const [assetQueries, setAssetQueries] = useState({});
  const [view, setView] = useState(() => readSetting('imon-library-view', 'grid') === 'list' ? 'list' : 'grid');
  const [favorites, setFavorites] = useState(readFavorites), [toast, setToast] = useState('');
  const toastTimer = useRef(null), searchRef = useRef(null), titleRef = useRef(null), mainRef = useRef(null);
  const currentHash = useRef(location.hash), positions = useRef(new Map()), movement = useRef('initial');
  const latest = useMemo(() => latestPacks(catalog), [catalog]);
  const resolution = useMemo(() => resolveRoute(requestedRoute, latest), [requestedRoute, latest]);
  const route = load === 'ready' ? resolution.route : requestedRoute;
  const selected = resolution.pack, selectedAsset = resolution.asset;
  const notify = useCallback(async (message, copy = false) => {
    if (copy) { try { await navigator.clipboard.writeText(message); } catch { setToast('Не удалось скопировать. Выдели код вручную.'); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500); return; } }
    clearTimeout(toastTimer.current); setToast(copy ? 'Скопировано' : message); toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const navigate = useCallback((href = '', options = {}) => {
    if (href === currentHash.current || (!href && !currentHash.current)) return;
    positions.current.set(currentHash.current, scrollY);
    history[options.replace ? 'replaceState' : 'pushState']({ imonLibrary: true }, '', location.pathname + location.search + href);
    currentHash.current = location.hash; movement.current = options.replace ? 'replace' : 'push';
    setRoute(readRoute()); setToast('');
  }, []);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const changed = () => {
      if (currentHash.current === location.hash) return;
      positions.current.set(currentHash.current, scrollY);
      currentHash.current = location.hash; movement.current = 'pop'; setRoute(readRoute()); setToast('');
    };
    addEventListener('hashchange', changed); addEventListener('popstate', changed);
    return () => { history.scrollRestoration = previous; removeEventListener('hashchange', changed); removeEventListener('popstate', changed); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoad('loading');
    fetch('/api/catalog.json', { signal: controller.signal, cache: 'no-cache', redirect: 'error' }).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); }).then(data => {
      if (controller.signal.aborted) return;
      if (data.schemaVersion !== 1 || !Array.isArray(data.packs) || data.packs.length > 500) throw new Error('Unsupported catalog');
      setCatalog(data.packs.map(pack => validatePack(pack, location.origin))); setLoad('ready');
    }).catch(() => { if (!controller.signal.aborted) setLoad('error'); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (load !== 'ready' || resolution.missing || resolution.canonicalHash === requestedRoute.hash) return;
    const target = resolution.canonicalHash;
    const savedPosition = positions.current.get(requestedRoute.hash);
    if (savedPosition !== undefined) positions.current.set(target, savedPosition);
    history.replaceState(history.state, '', location.pathname + location.search + target);
    currentHash.current = target;
    setRoute(parseRoute(target));
  }, [load, requestedRoute.hash, resolution.canonicalHash, resolution.missing]);
  useEffect(() => {
    if (load !== 'ready') return;
    const frame = requestAnimationFrame(() => { titleRef.current?.focus({ preventScroll: true }); scrollTo(0, movement.current === 'pop' ? positions.current.get(route.hash) || 0 : 0); });
    return () => cancelAnimationFrame(frame);
  }, [route.hash, load]);
  useEffect(() => {
    const handler = event => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (event.key === '/' && searchRef.current && !typing && !document.querySelector('[data-state="open"][role="dialog"]')) { event.preventDefault(); searchRef.current.focus(); }
    };
    addEventListener('keydown', handler); return () => removeEventListener('keydown', handler);
  }, [route.hash]);
  const folders = useMemo(() => {
    const result = new Map();
    for (const pack of latest) if (pack.folder) { const folder = result.get(pack.folder.id) || { ...pack.folder, count: 0 }; folder.count++; result.set(folder.id, folder); }
    return [...result.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }, [latest]);
  const selectedFolder = folders.find(folder => folder.id === route.folderId);
  const missing = load === 'ready' && resolution.missing;
  const isListing = ['all', 'folder', 'favorites'].includes(route.kind) && !missing;
  const collectionPacks = useMemo(() => latest.filter(pack => route.kind === 'favorites' ? favorites.has(pack.id) : route.kind === 'folder' ? pack.folder?.id === route.folderId : true), [latest, route.kind, route.folderId, favorites]);
  const filtered = useMemo(() => {
    const terms = termsFor(query);
    return collectionPacks.filter(pack => (category === 'all' || pack.category === category) && (!tag || pack.tags.includes(tag)) && matchesTerms(terms, [pack.id, pack.title, pack.summary, pack.folder?.title || '', categoryName(pack.category), ...pack.tags, ...pack.assets.flatMap(asset => [asset.id, asset.title, asset.description])]))
      .sort((a, b) => (sort === 'category' ? categoryName(a.category).localeCompare(categoryName(b.category), 'ru') : sort === 'assets' ? b.assets.length - a.assets.length : 0) || a.title.localeCompare(b.title, 'ru'));
  }, [collectionPacks, query, category, tag, sort]);
  const toggleFavorite = useCallback(id => setFavorites(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); if (!saveSetting('imon-library-favorites', JSON.stringify([...next]))) notify('Избранное сохранено только до закрытия страницы'); return next; }), [notify]);
  const clearFilters = () => { setCategory('all'); setTag(''); };
  const clearSearch = () => { setQuery(''); clearFilters(); };
  const pageTitle = missing ? 'Страница не найдена' : route.kind === 'asset' ? selectedAsset?.title || 'Ассет' : route.kind === 'collection' ? selected?.title || 'Коллекция' : route.kind === 'folder' ? selectedFolder?.title || 'Папка' : route.kind === 'favorites' ? 'Избранное' : 'Все коллекции';
  const crumbs = [];
  if (route.kind !== 'all') {
    crumbs.push({ title: 'Библиотека', href: '' });
    if (selected?.folder) crumbs.push({ title: selected.folder.title, href: folderHref(selected.folder.id) });
    if (selectedAsset) crumbs.push({ title: selected.title, href: packHref(selected) });
    crumbs.push({ title: pageTitle });
  }
  const savedCount = latest.filter(pack => favorites.has(pack.id)).length;
  const hasPacks = latest.length > 0;
  const count = isListing ? filtered.length : null;
  return <Theme appearance={appearance} accentColor="gray" grayColor="gray" radius="medium" scaling="100%" panelBackground="solid" hasBackground={false} className="library-theme" data-appearance={appearance}>
    <a className="skip-link" href="#catalog" onClick={event => { event.preventDefault(); mainRef.current?.focus(); mainRef.current?.scrollIntoView(); }}>К каталогу</a>
    <div className="library-frame"><aside className="workspace-sidebar" aria-label="Навигация библиотеки">
      <div className="sidebar-brand"><PageLink className="brand" href="" navigate={navigate} aria-label="I’MON Design Library"><BrandMark /><span className="brand-label">design library</span></PageLink></div>
      <nav className="collection-nav" aria-label="Библиотека"><PageLink className="collection-nav-link" href="" navigate={navigate} beforeNavigate={clearSearch} aria-current={route.kind === 'all' ? 'page' : undefined}><GridIcon /><span>Все коллекции</span><span className="tab-count">{latest.length}</span></PageLink><PageLink className="collection-nav-link" href="#view=favorites" navigate={navigate} beforeNavigate={clearSearch} aria-current={route.kind === 'favorites' ? 'page' : undefined}><BookmarkIcon /><span>Избранное</span><span className="tab-count">{savedCount}</span></PageLink></nav>
      {folders.length > 0 && <nav className="sidebar-folders" aria-label="Папки"><span className="sidebar-label">Папки</span>{folders.map(folder => <PageLink className="folder-nav" key={folder.id} href={folderHref(folder.id)} navigate={navigate} beforeNavigate={clearSearch} data-folder={folder.id} data-active={route.folderId === folder.id || selected?.folder?.id === folder.id ? 'true' : undefined} aria-current={route.kind === 'folder' && route.folderId === folder.id ? 'page' : undefined}><FolderSymbol /><span>{folder.title}</span><span className="tab-count">{folder.count}</span></PageLink>)}</nav>}
      <div className="sidebar-bottom"><div className="sidebar-links"><a className="text-link" href={REPOSITORY} target="_blank" rel="noopener noreferrer">GitHub <ArrowTopRightIcon /></a></div><div className="appearance-control"><span>Оформление</span><ThemeSwitch value={choice} onChange={choose} /></div></div>
    </aside>
    <main className="library-shell" id="catalog" ref={mainRef} tabIndex={-1}>
      <header className="workspace-heading"><div className="workspace-title"><Breadcrumbs items={crumbs} navigate={navigate} /><div className="page-title-line"><h1 ref={titleRef} tabIndex={-1} className={'page-title' + (route.kind === 'collection' ? ' collection-title' : route.kind === 'asset' ? ' asset-title' : '')}>{pageTitle}</h1>{load === 'ready' && hasPacks && count !== null && <span className="heading-count" aria-live="polite">{count}</span>}</div></div>
      <div className="heading-actions">{selected && !missing && <>
        <FavoriteButton className="header-bookmark" pack={selected} saved={favorites.has(selected.id)} onFavorite={toggleFavorite} />
        {selectedAsset && fileFor(selected, selectedAsset) ? <Button asChild highContrast size="2"><a href={fileFor(selected, selectedAsset).url} download={selectedAsset.path.split('/').at(-1)}><DownloadIcon />Скачать ассет</a></Button>
          : <Button asChild highContrast size="2"><a href={selected.downloadUrl} download={selected.id + '-' + selected.version + '.zip'}><DownloadIcon />Скачать коллекцию</a></Button>}
      </>}</div></header>
      {load === 'loading' ? <div className="library-empty"><p className="muted-copy" role="status">Загружаем библиотеку</p></div>
        : load === 'error' ? <div className="library-empty"><div className="empty-copy"><h2>Каталог не загрузился</h2><p>Проверь соединение и попробуй еще раз.</p><Button variant="surface" onClick={() => setAttempt(value => value + 1)}>Попробовать снова</Button></div></div>
        : missing ? <div className="library-empty"><div className="empty-copy"><h2>Не удалось найти этот материал</h2><p>Проверь ссылку или вернись в библиотеку.</p><Button asChild variant="surface"><PageLink href="" navigate={navigate}>Все коллекции</PageLink></Button></div></div>
        : route.kind === 'collection' ? <CollectionPage key={packKey(selected)} pack={selected} navigate={navigate} notify={notify} searchRef={searchRef} query={assetQueries[packKey(selected)] || ''} setQuery={value => setAssetQueries(current => ({ ...current, [packKey(selected)]: value }))} />
        : route.kind === 'asset' ? <AssetPage key={packKey(selected) + '/' + selectedAsset.id} pack={selected} asset={selectedAsset} navigate={navigate} notify={notify} />
        : <>
          {hasPacks && <div className="library-toolbar"><SearchField value={query} onChange={setQuery} inputRef={searchRef} /><div className="toolbar-actions"><FilterMenu category={category} setCategory={setCategory} tag={tag} setTag={setTag} packs={collectionPacks} clear={clearFilters} /><Select.Root value={sort} onValueChange={setSort}><Select.Trigger className="sort-select" aria-label="Сортировка коллекций" variant="ghost" /><Select.Content position="popper"><Select.Item value="title">По названию</Select.Item><Select.Item value="category">По категории</Select.Item><Select.Item value="assets">По числу ассетов</Select.Item></Select.Content></Select.Root><SegmentedControl.Root className="view-switch" size="1" aria-label="Вид каталога" value={view} onValueChange={value => { setView(value); saveSetting('imon-library-view', value); }}><SegmentedControl.Item value="grid" aria-label="Плитка" title="Плитка"><GridIcon /></SegmentedControl.Item><SegmentedControl.Item value="list" aria-label="Список" title="Список"><RowsIcon /></SegmentedControl.Item></SegmentedControl.Root></div></div>}
          {(category !== 'all' || tag) && <div className="active-filters">{category !== 'all' && <Button variant="soft" size="1" color="gray" onClick={() => { setCategory('all'); setTag(''); }}>{categoryName(category)}<Cross2Icon /></Button>}{tag && <Button variant="soft" size="1" color="gray" onClick={() => setTag('')}>{tag}<Cross2Icon /></Button>}<button onClick={clearFilters}>Сбросить</button></div>}
          <div className="catalog-results">{!hasPacks && route.kind === 'all' ? <div className="library-empty"><div className="empty-copy"><h2>Пока нет коллекций</h2></div></div>
            : filtered.length ? <div className={view === 'list' ? 'pack-list' : 'pack-grid'}>{filtered.map(pack => <PackCard key={packKey(pack)} pack={pack} saved={favorites.has(pack.id)} navigate={navigate} onFavorite={toggleFavorite} />)}</div>
              : route.kind === 'favorites' && !query && category === 'all' && !tag ? <div className="library-empty"><div className="empty-copy"><h2>Нет сохраненных коллекций</h2><p>Сохраненные коллекции появятся здесь.</p><Button asChild variant="surface"><PageLink href="" navigate={navigate}>Все коллекции</PageLink></Button></div></div>
                : <div className="empty-state"><h2>Ничего не нашлось</h2><p>Попробуй другое слово или убери часть фильтров.</p><Button variant="surface" onClick={clearSearch}>Сбросить поиск</Button></div>}</div>
        </>}
      <footer className="catalog-footer">{hasPacks && isListing && (query.trim() || category !== 'all' || tag) && <span>Показано {filtered.length} из {collectionPacks.length}</span>}<a href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer">Лицензии интерфейса</a></footer>
    </main></div><Toast message={toast} />
  </Theme>;
}
class CatalogBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal-error"><h1>Не удалось открыть каталог</h1><p>Обнови страницу или открой репозиторий.</p><a href={REPOSITORY}>Открыть GitHub</a></main> : this.props.children; }
}
createRoot(document.getElementById('root')).render(<CatalogBoundary><App /></CatalogBoundary>);
