import React, { memo, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

function PreviewFrame({ src, title, scripts, interactive }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="preview-surface" data-preview-status={failed ? 'error' : loaded ? 'ready' : 'loading'}>
    <iframe src={src} title={title} sandbox={scripts ? 'allow-scripts' : ''} referrerPolicy="no-referrer"
      tabIndex={interactive ? 0 : -1} loading="eager" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    {(!loaded || failed) && <span className="preview-loading" aria-hidden="true">{failed ? 'Превью недоступно' : 'Загрузка'}</span>}
  </div>;
}

// A new iframe owns each source/version. No cross-frame messages, shared DOM or
// allow-same-origin. Visibility is the lifecycle boundary, not a launch button.
export const LivePreview = memo(function LivePreview({ src, title, scripts = false, autoplay = false, interactive = true, className = '' }) {
  const host = useRef(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const allowed = !!src && (!scripts || autoplay === true);

  useEffect(() => {
    const changed = () => flushSync(() => setVisible(document.visibilityState !== 'hidden'));
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  useEffect(() => {
    const element = host.current;
    setNear(false);
    if (!allowed || !element) return;
    if (typeof IntersectionObserver !== 'undefined') {
      const approach = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) setNear(true);
      }, { rootMargin: '80px 0px', threshold: 0 });
      const retention = new IntersectionObserver(entries => {
        if (entries.every(entry => !entry.isIntersecting)) setNear(false);
      }, { rootMargin: '320px 0px', threshold: 0 });
      approach.observe(element); retention.observe(element);
      return () => { approach.disconnect(); retention.disconnect(); };
    }
    // Conservative fallback: never mount the entire catalog at once.
    let scheduled = 0;
    const check = () => {
      scheduled = 0;
      const rect = element.getBoundingClientRect();
      setNear(current => rect.bottom >= -(current ? 320 : 80) && rect.top <= innerHeight + (current ? 320 : 80));
    };
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(check); };
    check();
    addEventListener('scroll', schedule, { passive: true, capture: true }); addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(scheduled); removeEventListener('scroll', schedule, true); removeEventListener('resize', schedule); };
  }, [src, allowed]);

  const mounted = allowed && near && visible;
  return <div ref={host} className={'live-preview ' + className} data-mounted={String(mounted)}
    data-preview-policy={!src ? 'missing' : allowed ? 'automatic' : 'restricted'} aria-hidden={!interactive || undefined} inert={!interactive}>
    {mounted ? <PreviewFrame key={src} src={src} title={title} scripts={scripts} interactive={interactive} />
      : !allowed ? <div className="preview-restricted"><span>Без превью</span></div>
        : <span className="preview-idle" aria-hidden="true" />}
  </div>;
});
