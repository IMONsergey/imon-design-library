// Runs before CSS/React to avoid flashing the opposite appearance on reload.
(() => {
  let choice = 'system';
  try { const saved = localStorage.getItem('imon-library-theme'); if (['light', 'dark', 'system'].includes(saved)) choice = saved; } catch { /* Optional persistence. */ }
  const appearance = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : choice;
  document.documentElement.dataset.theme = appearance;
  document.documentElement.classList.add(appearance);
  document.documentElement.style.colorScheme = appearance;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#111111' : '#fafafa');
})();
