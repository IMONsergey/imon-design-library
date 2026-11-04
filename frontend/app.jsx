import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import { validatePack } from './catalog.mjs';
import { BrandMark } from './brand.jsx';
import { Button, Dialog, IconButton, Popover, SegmentedControl, Select, Tabs, TextField, Theme, Tooltip } from '@radix-ui/themes';
import { ArrowDownIcon, ArrowTopRightIcon, BookmarkFilledIcon, BookmarkIcon, CheckIcon, CodeIcon, CopyIcon, Cross2Icon, DesktopIcon, DownloadIcon, FileTextIcon, GridIcon, MixerHorizontalIcon, MoonIcon, PlusIcon, RowsIcon, MagnifyingGlassIcon, SunIcon } from '@radix-ui/react-icons';
import '@radix-ui/themes/styles.css';
import '@fontsource-variable/inter';
import './styles.css';

const REPOSITORY = 'https://github.com/IMONsergey/imon-design-library';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categoryList = [['design-system', 'Дизайн-системы'], ['components', 'Компоненты'], ['motion', 'Движение'], ['icons', 'Иконки'], ['typography', 'Типографика'], ['guidelines', 'Правила'], ['templates', 'Шаблоны']];
const categoryName = id => categoryList.find(item => item[0] === id)?.[1] || 'Материалы';
const pluralRules = new Intl.PluralRules('ru');
const plural = (count, forms) => `${count} ${forms[{ one: 0, few: 1, many: 2 }[pluralRules.select(count)] ?? 2]}`;
const assetCount = count => plural(count, ['ассет', 'ассета', 'ассетов']);
const packKey = pack => `${pack.id}@${pack.version}`;
const compareVersion = (a, b) => { const aa = a.version.split('.').map(Number), bb = b.version.split('.').map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i]; return 0; };
const getRoute = () => new URLSearchParams(location.hash.slice(1)).get('pack') || '';
const readSetting = (name, fallback) => { try { return localStorage.getItem(name) ?? fallback; } catch { return fallback; } };
function saveSetting(name, value) { try { localStorage.setItem(name, value); return true; } catch { return false; } }
function readFavorites() { try { const saved = JSON.parse(readSetting('imon-library-favorites', '[]')); return new Set(Array.isArray(saved) ? saved.filter(value => typeof value === 'string' && SLUG.test(value)) : []); } catch { return new Set(); } }
function bytes(size) { return size < 1024 ? `${size} Б` : size < 1048576 ? `${(size / 1024).toLocaleString('ru', { maximumFractionDigits: 1 })} КБ` : `${(size / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ`; }
const nonce = document.querySelector('meta[name="csp-nonce"]')?.content;
if (nonce && nonce !== '__IMON_CSP_NONCE__') setNonce(nonce);

function useAppearance() {
  const [choice, setChoice] = useState(() => { const saved = readSetting('imon-library-theme', 'system'); return ['light', 'dark', 'system'].includes(saved) ? saved : 'system'; });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const appearance = choice === 'system' ? systemDark ? 'dark' : 'light' : choice;
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const changed = event => setSystemDark(event.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  useEffect(() => { document.documentElement.dataset.theme = appearance; document.documentElement.style.colorScheme = appearance; document.documentElement.classList.toggle('dark', appearance === 'dark'); document.documentElement.classList.toggle('light', appearance === 'light'); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#111111' : '#fafafa'); }, [appearance]);
  const choose = value => { if (!['light', 'dark', 'system'].includes(value)) return; saveSetting('imon-library-theme', value); setChoice(value); };
  return { appearance, choice, choose };
}
function ThemeSwitch({ value, onChange }) {
  return <SegmentedControl.Root className="theme-switch" aria-label="Тема оформления" size="1" value={value} onValueChange={onChange}>
    <SegmentedControl.Item value="light" aria-label="Светлая тема" title="Светлая"><SunIcon /></SegmentedControl.Item>
    <SegmentedControl.Item value="dark" aria-label="Темная тема" title="Темная"><MoonIcon /></SegmentedControl.Item>
    <SegmentedControl.Item value="system" aria-label="Системная тема" title="Как на устройстве"><DesktopIcon /></SegmentedControl.Item>
  </SegmentedControl.Root>;
}
function Toast({ message }) { return <div className="toast-region" aria-live="polite" aria-atomic="true">{message && <div className="toast" role="status"><CheckIcon />{message}</div>}</div>; }

const PackCover = memo(function PackCover({ pack }) {
  const host = useRef(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => { const node = host.current; if (!node || pack.scripts) return; const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / 720)); observer.observe(node); return () => observer.disconnect(); }, [pack.scripts]);
  return <div className="pack-cover" ref={host} aria-hidden="true" inert>
    {pack.scripts ? <div className="script-cover"><CodeIcon /><span>Интерактивный пак</span><small>Запуск внутри превью</small></div> : <div className="cover-viewport"><iframe key={packKey(pack)} title={`Превью ${pack.title}`} sandbox="" src={pack.previewUrl} referrerPolicy="no-referrer" loading="lazy" tabIndex={-1} style={{ width: 720, height: 480, transform: `scale(${scale})` }} /></div>}
    <div className="cover-overlay"><span>Открыть пак <ArrowTopRightIcon /></span></div>
  </div>;
});
const PackCard = memo(function PackCard({ pack, saved, onOpen, onFavorite }) {
  return <article className="pack-card" data-pack={packKey(pack)}>
    <a className="pack-link" href={`#pack=${packKey(pack)}`} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(pack, event.currentTarget); }}>
      <PackCover pack={pack} />
      <div className="pack-body"><p className="pack-category">{categoryName(pack.category)}</p><h2 className="pack-title">{pack.title}</h2><p className="pack-summary">{pack.summary}</p><div className="pack-meta"><span>{assetCount(pack.assets.length)}</span><span className="meta-separator">/</span><span className="version">v{pack.version}</span><span className="open-hint"><ArrowTopRightIcon /></span></div></div>
    </a>
    <Tooltip content={saved ? 'Убрать из избранного' : 'Сохранить в избранное'}><IconButton className={`bookmark${saved ? ' is-saved' : ''}`} variant="ghost" color="gray" size="2" aria-label={`${saved ? 'Убрать из избранного' : 'В избранное'}: ${pack.title}`} aria-pressed={saved} onClick={() => onFavorite(pack.id)}>{saved ? <BookmarkFilledIcon /> : <BookmarkIcon />}</IconButton></Tooltip>
  </article>;
});
function FilterMenu({ category, setCategory, tag, setTag, packs, clear }) {
  const tags = useMemo(() => [...new Set(packs.filter(pack => category === 'all' || pack.category === category).flatMap(pack => pack.tags))].sort((a, b) => a.localeCompare(b, 'ru')), [category, packs]);
  const count = Number(category !== 'all') + Number(!!tag);
  return <Popover.Root><Popover.Trigger><Button className="filter-button" variant="surface" color="gray" size="2"><MixerHorizontalIcon />Фильтры{count > 0 && <span className="filter-count">{count}</span>}</Button></Popover.Trigger><Popover.Content className="filter-popover" width="300" align="end">
    <div className="popover-heading"><strong>Фильтры</strong>{count > 0 && <Button variant="ghost" color="gray" size="1" onClick={clear}>Сбросить</Button>}</div>
    <label className="field-label" id="category-label">Категория</label><Select.Root value={category} onValueChange={value => { setCategory(value); setTag(''); }}><Select.Trigger aria-labelledby="category-label" className="category-select" /><Select.Content position="popper"><Select.Item value="all">Все категории</Select.Item>{categoryList.map(([id, title]) => <Select.Item key={id} value={id}>{title} · {packs.filter(pack => pack.category === id).length}</Select.Item>)}</Select.Content></Select.Root>
    <span className="field-label tag-label">Теги</span><div className="filter-tags">{tags.length ? tags.slice(0, 40).map(name => <button className={`filter-tag${tag === name ? ' is-active' : ''}`} aria-pressed={tag === name} onClick={() => setTag(tag === name ? '' : name)} key={name}>{name}</button>) : <p className="muted-copy">В этой категории пока нет паков.</p>}</div>
  </Popover.Content></Popover.Root>;
}

function PackDialog({ pack, versions, open, onClose, onVersion, returnFocus, notify, toast }) {
  const [tab, setTab] = useState('preview');
  const [width, setWidth] = useState('desktop');
  const [launchedKey, setLaunchedKey] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileState, setFileState] = useState({ status: 'idle', text: '' });
  const [retry, setRetry] = useState(0);
  const titleRef = useRef(null);
  const key = pack ? packKey(pack) : '';
  useEffect(() => { setTab('preview'); setWidth('desktop'); setLaunchedKey(''); setFileState({ status: 'idle', text: '' }); setFilePath(pack?.files.find(file => /\.(css|js|json|html)$/i.test(file.path))?.path || pack?.files[0]?.path || ''); }, [key, open]);
  const file = pack?.files.find(item => item.path === filePath);
  useEffect(() => {
    if (!open || tab !== 'files' || !file) return;
    if (!/\.(?:html?|css|m?js|json|svg|txt|md)$/i.test(file.path) || file.size > 524288) { setFileState({ status: 'binary', text: '' }); return; }
    const controller = new AbortController(); setFileState({ status: 'loading', text: '' });
    fetch(file.url, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('Файл недоступен'); return response.text(); }).then(text => { if (controller.signal.aborted) return; if (text.length > 524288) throw new Error('Файл слишком большой'); setFileState({ status: 'ready', text }); }).catch(() => { if (!controller.signal.aborted) setFileState({ status: 'error', text: '' }); });
    return () => controller.abort();
  }, [key, open, tab, filePath, retry]);
  if (!pack) return null;
  const lines = fileState.status === 'ready' ? fileState.text.split('\n').length : 0;
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Content className="pack-detail" maxWidth="none" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}>
    <div className="detail-header"><div className="detail-title-block"><p className="detail-pretitle">{categoryName(pack.category)}</p><Dialog.Title ref={titleRef} tabIndex={-1} className="detail-title">{pack.title}</Dialog.Title><Dialog.Description className="detail-description">{pack.summary}</Dialog.Description></div><div className="detail-header-actions"><Select.Root value={pack.version} onValueChange={onVersion}><Select.Trigger aria-label="Версия пака" variant="surface" /><Select.Content position="popper">{versions.map(item => <Select.Item key={item.version} value={item.version}>v{item.version}</Select.Item>)}</Select.Content></Select.Root><Dialog.Close><IconButton variant="ghost" color="gray" size="2" aria-label="Закрыть пак"><Cross2Icon /></IconButton></Dialog.Close></div></div>
    <div className="detail-workspace"><Tabs.Root className="detail-tabs-root" value={tab} onValueChange={setTab}>
      <div className="detail-toolbar"><Tabs.List className="detail-tabs" aria-label="Содержание пака"><Tabs.Trigger value="preview">Превью</Tabs.Trigger><Tabs.Trigger value="files">Файлы и код</Tabs.Trigger><Tabs.Trigger value="guide">Правила</Tabs.Trigger></Tabs.List><div className="detail-actions"><Button asChild variant="solid" highContrast size="2"><a href={pack.downloadUrl} download={`${pack.id}-${pack.version}.zip`}><DownloadIcon />Скачать пак<span className="download-size">{bytes(pack.downloadSize)}</span></a></Button></div></div>
      <Tabs.Content className="preview-panel" value="preview"><div className="preview-controls"><span className="preview-caption">Оригинальное оформление пака</span><SegmentedControl.Root size="1" value={width} onValueChange={setWidth} aria-label="Ширина превью"><SegmentedControl.Item value="desktop" aria-label="Широкое превью"><DesktopIcon /></SegmentedControl.Item><SegmentedControl.Item value="mobile" aria-label="Мобильное превью">390</SegmentedControl.Item></SegmentedControl.Root></div><div className="preview-canvas" data-width={width}>{pack.scripts && launchedKey !== key ? <div className="launch-preview"><CodeIcon /><h3>Интерактивное превью</h3><p>В этом паке есть JavaScript. Он запускается отдельно от каталога, с ограниченным доступом к браузеру и сети.</p><Button onClick={() => setLaunchedKey(key)} highContrast>Запустить превью</Button></div> : open && <iframe key={key} className="detail-frame" src={pack.previewUrl} sandbox={pack.scripts ? 'allow-scripts' : ''} referrerPolicy="no-referrer" title={`Интерактивное превью ${pack.title}`} />}</div><p className="preview-footnote">Превью изолировано. Тема каталога не меняет дизайн самого пака.</p></Tabs.Content>
      <Tabs.Content value="files" className="files-panel"><nav className="file-nav" aria-label="Файлы пака"><div className="file-nav-heading">Файлы <span>{pack.files.length}</span></div>{pack.files.map(item => <button key={item.path} className={`file-item${filePath === item.path ? ' is-active' : ''}`} title={item.path} aria-pressed={filePath === item.path} onClick={() => setFilePath(item.path)}><FileTextIcon /><span>{item.path}</span><small>{bytes(item.size)}</small></button>)}</nav><div className="code-column"><div className="code-header"><span className="code-filename">{file?.path || 'Файл не выбран'}</span><div className="code-actions">{file && <Tooltip content="Скачать файл"><IconButton asChild variant="ghost" color="gray" size="1"><a href={file.url} download={file.path.split('/').at(-1)} aria-label="Скачать файл"><ArrowDownIcon /></a></IconButton></Tooltip>}<Button variant="surface" color="gray" size="1" disabled={fileState.status !== 'ready'} onClick={() => notify(fileState.text, true)}><CopyIcon />Копировать</Button></div></div>
        {fileState.status === 'ready' ? <div className="code-scroll" tabIndex={0} aria-label={`Код файла ${file?.path}`}><pre className="code-lines" aria-hidden="true">{Array.from({ length: Math.min(lines, 10000) }, (_, index) => index + 1).join('\n')}</pre><pre className="code-source"><code>{fileState.text}</code></pre></div> : <div className="code-placeholder">{fileState.status === 'loading' ? <><span className="loading-indicator" />Загружаем файл</> : fileState.status === 'error' ? <><p>Не удалось открыть файл.</p><Button size="1" variant="outline" onClick={() => setRetry(value => value + 1)}>Повторить</Button></> : fileState.status === 'binary' ? <><FileTextIcon /><p>{file?.size > 524288 ? 'Большой файл удобнее открыть после скачивания.' : 'Этот файл доступен в оригинальном формате.'}</p>{file && <Button asChild variant="surface" size="2"><a href={file.url} download>Скачать файл</a></Button>}</> : 'Выбери файл слева.'}</div>}
        <div className="code-meta"><span>{file ? bytes(file.size) : ''}{lines > 0 ? ` · ${plural(lines, ['строка', 'строки', 'строк'])}` : ''}</span><span title={file?.sha256}>SHA-256 {file?.sha256?.slice(0, 12)}…</span></div></div></Tabs.Content>
      <Tabs.Content value="guide" className="guide-panel"><div className="guide-main"><h3>Что внутри</h3>{pack.assets.map(asset => <article className="guide-asset" key={asset.id || asset.path}><div className="guide-asset-heading"><h4>{asset.title}</h4><span>{asset.path}</span></div><p>{asset.description}</p><pre>{asset.usage}</pre></article>)}</div><aside className="guide-aside"><h3>О паке</h3><dl><dt>Автор</dt><dd>{pack.source?.author || 'Не указан'}</dd><dt>Лицензия</dt><dd>{pack.license.id}</dd><dt>Проверка</dt><dd>{pack.review?.date || 'Не указана'}</dd><dt>Версия</dt><dd>{pack.version}</dd></dl><p>Условия лицензии сохраняются при использовании. Публикация в каталоге не делает материал свободным.</p>{safeSource(pack.source?.url) && <a href={safeSource(pack.source.url)} target="_blank" rel="noopener noreferrer" className="text-link">Первоисточник <ArrowTopRightIcon /></a>}</aside></Tabs.Content>
    </Tabs.Root></div><div className="detail-footer"><span>{assetCount(pack.assets.length)}<span className="meta-separator">/</span>{plural(pack.files.length, ['файл', 'файла', 'файлов'])}</span><Button className="copy-context" variant="ghost" color="gray" size="1" onClick={() => notify(contextFor(pack), true)}><CopyIcon />Контекст для чата</Button></div><Toast message={toast} />
  </Dialog.Content></Dialog.Root>;
}
function safeSource(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function contextFor(pack) { return [`I’MON Design Library: ${REPOSITORY}`, `Пак: ${pack.id}`, `Версия: ${pack.version}`, `Ссылка: ${location.origin}/#pack=${packKey(pack)}`, `Исходники: packs/${pack.id}/${pack.version}/`, `Манифест: ${location.origin}${pack.manifestUrl}`, `Лицензия: ${pack.license.id}`, '', 'Прочитай AGENTS.md, manifest.json и README пака. Используй только выбранный пак, не смешивай его стили с другими системами. Проверь лицензию и зависимости перед интеграцией.', '', ...pack.assets.map(asset => `- ${asset.title}: ${asset.path}`)].join('\n'); }
function AddDialog({ open, onOpenChange, notify, toast, triggerLabel = 'Добавить' }) {
  const prompt = `Добавь этот материал в I’MON Design Library (${REPOSITORY}). Создай отдельный пак или используй указанный мной. Проверь источник и права, подготовь изолированное превью и инструкцию. Не смешивай разные дизайн-системы. Сначала прочитай AGENTS.md и docs/ADDING_ASSETS.md. Публикуй только материалы, которые разрешено раскрывать.`;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Trigger><Button className="add-pack" highContrast size="2"><PlusIcon /><span>{triggerLabel}</span></Button></Dialog.Trigger><Dialog.Content className="add-dialog" maxWidth="520px"><div className="add-dialog-header"><span className="dialog-kicker">Пополнение библиотеки</span><Dialog.Close><IconButton variant="ghost" color="gray" aria-label="Закрыть инструкцию"><Cross2Icon /></IconButton></Dialog.Close></div><Dialog.Title size="6">Добавление через чат</Dialog.Title><Dialog.Description className="add-description">Передай файл или ссылку в чат с доступом к этому репозиторию. Укажи, в какой пак сохранить материал.</Dialog.Description><ol className="howto-steps"><li><span>01</span><div><strong>Прикрепи материал</strong><p>Код, компонент, набор иконок или правила.</p></div></li><li><span>02</span><div><strong>Укажи пак</strong><p>Существующий или новый, отдельно от других систем.</p></div></li><li><span>03</span><div><strong>Проверь результат</strong><p>Превью, инструкцию, источник и права на использование.</p></div></li></ol><p className="privacy-note">Сайт и репозиторий публичные. Закрытые клиентские материалы сюда не добавляем.</p><div className="add-dialog-footer"><Button highContrast onClick={() => notify(prompt, true)}><CopyIcon />Копировать запрос</Button><a className="text-link" href={`${REPOSITORY}/blob/main/docs/ADDING_ASSETS.md`} target="_blank" rel="noopener noreferrer">Инструкция <ArrowTopRightIcon /></a></div><Toast message={toast} /></Dialog.Content></Dialog.Root>;
}

function App() {
  const { appearance, choice, choose } = useAppearance();
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 680px)').matches);
  useEffect(() => { const media = matchMedia('(max-width: 680px)'); const changed = event => setCompact(event.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const [catalog, setCatalog] = useState([]);
  const [load, setLoad] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [collection, setCollection] = useState('all');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('title');
  const [view, setView] = useState(() => readSetting('imon-library-view', 'grid') === 'list' ? 'list' : 'grid');
  const [favorites, setFavorites] = useState(readFavorites);
  const [route, setRoute] = useState(getRoute);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null), lastTrigger = useRef(null), searchRef = useRef(null), lastPack = useRef(null);
  const notify = useCallback(async (message, copy = false) => {
    if (copy) { try { await navigator.clipboard.writeText(message); } catch { setToast('Не удалось скопировать. Разреши доступ к буферу или выдели код вручную.'); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500); return; } }
    clearTimeout(toastTimer.current); setToast(copy ? 'Скопировано' : message); toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const controller = new AbortController(); setLoad('loading');
    fetch('/api/catalog.json', { signal: controller.signal, cache: 'no-cache' }).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); }).then(data => { if (controller.signal.aborted) return; if (data.schemaVersion !== 1 || !Array.isArray(data.packs) || data.packs.length > 500) throw new Error('Unsupported catalog'); setCatalog(data.packs.map(pack => validatePack(pack, location.origin))); setLoad('ready'); }).catch(() => { if (!controller.signal.aborted) setLoad('error'); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => { const changed = () => setRoute(getRoute()); addEventListener('hashchange', changed); addEventListener('popstate', changed); return () => { removeEventListener('hashchange', changed); removeEventListener('popstate', changed); }; }, []);
  const latest = useMemo(() => { const result = new Map(); for (const pack of [...catalog].sort(compareVersion)) if (!result.has(pack.id)) result.set(pack.id, pack); return [...result.values()]; }, [catalog]);
  const selected = useMemo(() => catalog.find(pack => packKey(pack) === route) || null, [catalog, route]);
  if (selected) lastPack.current = selected;
  const versions = useMemo(() => catalog.filter(pack => pack.id === (selected || lastPack.current)?.id).sort(compareVersion), [catalog, selected]);
  useEffect(() => { if (load === 'ready' && route && !selected) { history.replaceState(null, '', location.pathname + location.search); setRoute(''); notify('Эта версия пака не найдена'); } }, [load, route, selected, notify]);
  useEffect(() => { const handler = event => { const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable; if (event.key === '/' && searchRef.current && !typing && !route && !addOpen && !document.querySelector('[data-state="open"][role="dialog"]')) { event.preventDefault(); searchRef.current.focus(); } }; addEventListener('keydown', handler); return () => removeEventListener('keydown', handler); }, [route, addOpen]);
  const openPack = useCallback((pack, trigger) => { lastTrigger.current = trigger; setToast(''); history.pushState({ imonLibrary: true }, '', `#pack=${packKey(pack)}`); setRoute(packKey(pack)); }, []);
  const closePack = useCallback(() => { setRoute(''); setToast(''); if (history.state?.imonLibrary === true) history.back(); else history.replaceState(null, '', location.pathname + location.search); }, []);
  const changeVersion = value => { const pack = versions.find(item => item.version === value); if (pack) { history.replaceState(history.state, '', `#pack=${packKey(pack)}`); setRoute(packKey(pack)); } };
  const returnFocus = useCallback(() => { if (lastTrigger.current?.isConnected) lastTrigger.current.focus(); else searchRef.current?.focus(); }, []);
  const toggleFavorite = useCallback(id => { setFavorites(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); if (!saveSetting('imon-library-favorites', JSON.stringify([...next]))) notify('Избранное сохранено только до закрытия страницы'); return next; }); }, [notify]);
  const collectionPacks = useMemo(() => latest.filter(pack => collection === 'all' || favorites.has(pack.id)), [latest, collection, favorites]);
  const filtered = useMemo(() => { const terms = query.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean); return collectionPacks.filter(pack => (category === 'all' || pack.category === category) && (!tag || pack.tags.includes(tag)) && terms.every(term => [pack.title, pack.summary, pack.id, categoryName(pack.category), ...pack.tags, ...pack.assets.flatMap(asset => [asset.title, asset.description])].join(' ').toLocaleLowerCase('ru').includes(term))).sort((a, b) => (sort === 'category' ? categoryName(a.category).localeCompare(categoryName(b.category), 'ru') : sort === 'assets' ? b.assets.length - a.assets.length : 0) || a.title.localeCompare(b.title, 'ru')); }, [collectionPacks, category, tag, query, sort]);
  const clearFilters = () => { setCategory('all'); setTag(''); };
  const resetAll = () => { setQuery(''); setCategory('all'); setTag(''); setCollection('all'); };
  const savedCount = latest.filter(pack => favorites.has(pack.id)).length;
  const hasPacks = latest.length > 0;
  const availableCategories = categoryList.filter(([id]) => latest.some(pack => pack.category === id));
  const addControl = <AddDialog open={addOpen} onOpenChange={value => { setToast(''); setAddOpen(value); }} notify={notify} toast={toast} triggerLabel={hasPacks ? 'Добавить' : 'Как добавить'} />;
  return <Theme appearance={appearance} accentColor="gray" grayColor="gray" radius="medium" scaling="100%" panelBackground="solid" hasBackground={false} className="library-theme" data-appearance={appearance}>
    <a className="skip-link" href="#catalog">К каталогу</a>
    <Tabs.Root value={collection} orientation={compact ? 'horizontal' : 'vertical'} onValueChange={value => { setCollection(value); setCategory('all'); setTag(''); }} className="collection-root library-frame">
      <aside className="workspace-sidebar" aria-label="Навигация библиотеки">
        <div className="sidebar-brand"><a className="brand" href="/" aria-label="I’MON Design Library"><BrandMark /><span className="brand-label">design library</span></a></div>
        <Tabs.List className="collection-tabs" aria-label="Коллекция">
          <Tabs.Trigger value="all"><GridIcon /><span>Все паки</span><span className="tab-count">{latest.length}</span></Tabs.Trigger>
          <Tabs.Trigger value="favorites"><BookmarkIcon /><span>Избранное</span><span className="tab-count">{savedCount}</span></Tabs.Trigger>
        </Tabs.List>
        {hasPacks && <nav className="sidebar-categories" aria-label="Категории паков"><span className="sidebar-label">Категории</span>{availableCategories.map(([id, title]) => <button className="category-nav" key={id} aria-pressed={category === id && collection === 'all'} onClick={() => { setCollection('all'); setCategory(id); setTag(''); setQuery(''); }}><FileTextIcon /><span>{title}</span><span className="tab-count">{latest.filter(pack => pack.category === id).length}</span></button>)}</nav>}
        <div className="sidebar-bottom"><div className="sidebar-links"><a className="text-link" href={`${REPOSITORY}/blob/main/docs/ADDING_ASSETS.md`} target="_blank" rel="noopener noreferrer">Инструкция <ArrowTopRightIcon /></a><a className="text-link" href={REPOSITORY} target="_blank" rel="noopener noreferrer">GitHub <ArrowTopRightIcon /></a></div><div className="appearance-control"><span>Оформление</span><ThemeSwitch value={choice} onChange={choose} /></div></div>
      </aside>
      <main className="library-shell" id="catalog" tabIndex={-1}>
        <header className="workspace-heading"><div><h1>{collection === 'favorites' ? 'Избранное' : category === 'all' ? 'Все паки' : categoryName(category)}</h1>{hasPacks && <span className="heading-count" aria-live="polite">{filtered.length}</span>}</div><div className="heading-actions">{hasPacks && addControl}</div></header>
      {hasPacks && <div className="library-toolbar"><TextField.Root className="catalog-search" ref={searchRef} aria-label="Поиск по библиотеке" placeholder="Поиск по библиотеке" value={query} onChange={event => setQuery(event.target.value)} size="3"><TextField.Slot><MagnifyingGlassIcon /></TextField.Slot><TextField.Slot>{query ? <IconButton variant="ghost" size="1" color="gray" aria-label="Очистить поиск" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Cross2Icon /></IconButton> : <kbd>/</kbd>}</TextField.Slot></TextField.Root><div className="toolbar-actions"><FilterMenu category={category} setCategory={setCategory} tag={tag} setTag={setTag} packs={collectionPacks} clear={clearFilters} /><Select.Root value={sort} onValueChange={setSort}><Select.Trigger className="sort-select" aria-label="Сортировка паков" variant="ghost" /><Select.Content position="popper"><Select.Item value="title">По названию</Select.Item><Select.Item value="category">По категории</Select.Item><Select.Item value="assets">По числу ассетов</Select.Item></Select.Content></Select.Root><SegmentedControl.Root className="view-switch" size="1" aria-label="Вид каталога" value={view} onValueChange={value => { setView(value); saveSetting('imon-library-view', value); }}><SegmentedControl.Item value="grid" aria-label="Плитка" title="Плитка"><GridIcon /></SegmentedControl.Item><SegmentedControl.Item value="list" aria-label="Список" title="Список"><RowsIcon /></SegmentedControl.Item></SegmentedControl.Root></div></div>}
      {(category !== 'all' || tag) && <div className="active-filters">{category !== 'all' && <Button variant="soft" size="1" color="gray" onClick={() => { setCategory('all'); setTag(''); }}>{categoryName(category)}<Cross2Icon /></Button>}{tag && <Button variant="soft" size="1" color="gray" onClick={() => setTag('')}>{tag}<Cross2Icon /></Button>}<button onClick={clearFilters}>Сбросить</button></div>}
      {['all', 'favorites'].map(value => <Tabs.Content className="catalog-results" value={value} key={value}>{collection === value && <>
        {load === 'loading' ? <div className="library-empty"><p className="muted-copy" role="status">Загружаем библиотеку</p></div> : load === 'error' ? <div className="library-empty"><div className="empty-copy"><h2>Каталог не загрузился</h2><p>Проверь соединение и попробуй еще раз.</p><Button variant="surface" onClick={() => setAttempt(value => value + 1)}>Попробовать снова</Button></div></div> : !hasPacks && collection === 'all' ? <div className="library-empty"><div className="empty-copy"><h2>Пока нет паков</h2><p>Пришли в чат файл или ссылку и укажи, в какой пак его добавить.</p>{addControl}</div></div> : filtered.length ? <div className={view === 'list' ? 'pack-list' : 'pack-grid'}>{filtered.map(pack => <PackCard key={pack.id} pack={pack} saved={favorites.has(pack.id)} onOpen={openPack} onFavorite={toggleFavorite} />)}</div> : collection === 'favorites' && !query && category === 'all' && !tag ? <div className="library-empty"><div className="empty-copy"><h2>Нет сохраненных паков</h2><p>Отмечай нужные паки закладкой. Они будут доступны здесь, в этом браузере.</p><Button variant="surface" onClick={resetAll}>Все паки</Button></div></div> : <div className="empty-state"><h2>Ничего не нашлось</h2><p>Попробуй другое слово или убери часть фильтров.</p><Button variant="surface" onClick={resetAll}>Сбросить поиск</Button></div>}
      </>}</Tabs.Content>)}
      {hasPacks && <footer className="catalog-footer"><span>{`Показано ${filtered.length} из ${collectionPacks.length}`}</span><a href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer">Лицензии интерфейса</a></footer>}
    </main></Tabs.Root><PackDialog pack={selected || lastPack.current} versions={versions} open={!!selected} onClose={closePack} onVersion={changeVersion} returnFocus={returnFocus} notify={notify} toast={toast} />{!selected && !addOpen && <Toast message={toast} />}
  </Theme>;
}
class CatalogBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal-error"><h1>Не удалось открыть каталог</h1><p>Обнови страницу. Все материалы сохранены в репозитории.</p><a href={REPOSITORY}>Открыть GitHub</a></main> : this.props.children; }
}
createRoot(document.getElementById('root')).render(<CatalogBoundary><App /></CatalogBoundary>);
