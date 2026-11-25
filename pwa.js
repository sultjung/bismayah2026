(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(console.warn);
  const button = document.getElementById('installApp');
  const dialog = document.getElementById('installGuide');
  if (!button || !dialog) return;
  let promptEvent;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const refresh = () => { button.hidden = standalone(); };
  refresh();
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; refresh(); });
  window.addEventListener('appinstalled', () => { promptEvent = null; button.hidden = true; dialog.close(); });
  button.addEventListener('click', async () => {
    if (promptEvent) {
      const event = promptEvent; promptEvent = null;
      try { await event.prompt(); await event.userChoice; } catch { dialog.showModal(); }
    } else dialog.showModal();
  });
  matchMedia('(display-mode: standalone)').addEventListener('change', refresh);
})();