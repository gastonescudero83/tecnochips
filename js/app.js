/* =============================================================================
 * app.js — Arranque de la aplicación (orquestador)
 * -----------------------------------------------------------------------------
 * 1) Inicializa el Store (carga/seed). 2) Monta el shell de la tienda y el panel.
 * 3) Conecta el router (alterna tienda ↔ admin). 4) Registra el Service Worker
 * (si está servido por HTTP). 5) Gestiona el botón de instalación PWA.
 * Debe cargarse ÚLTIMO (depende de todos los módulos anteriores).
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store, Router, Storefront, Admin } = App;

  const storefrontRoot = document.getElementById('storefront-root');
  const adminRoot = document.getElementById('admin-root');
  const splash = document.getElementById('splash');

  async function boot() {
    try {
      await Store.init();
    } catch (e) {
      console.error('[App] Error al inicializar', e);
      if (splash) splash.innerHTML = '<p style="padding:2rem;text-align:center">No se pudo iniciar la base de datos local.<br>Probá con otro navegador.</p>';
      return;
    }

    Storefront.mountShell(storefrontRoot);
    Admin.mount(adminRoot);

    Router.start(dispatch);

    if (splash) { splash.classList.add('splash--hide'); setTimeout(() => splash.remove(), 350); }

    registerServiceWorker();
    setupInstallPrompt();
  }

  /** Decide qué interfaz mostrar según la ruta. */
  function dispatch(route) {
    const isAdmin = route.segments[0] === 'admin';
    document.body.classList.toggle('is-admin', isAdmin);
    if (isAdmin) {
      storefrontRoot.hidden = true;
      adminRoot.hidden = false;
      Admin.renderRoute(route);
    } else {
      adminRoot.hidden = true;
      storefrontRoot.hidden = false;
      Storefront.renderRoute(route);
    }
  }

  /* ---- Service Worker (PWA) --------------------------------------------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // En file:// no se puede registrar SW: la app igual funciona (IndexedDB).
    if (location.protocol === 'file:') {
      console.info('[PWA] Abierto como archivo local: sin Service Worker. Para instalar como app, serví por HTTP.');
      return;
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js')
        .then((reg) => console.info('[PWA] Service Worker registrado', reg.scope))
        .catch((err) => console.warn('[PWA] No se pudo registrar el SW', err));
    });
  }

  /* ---- Instalación PWA (Android / Windows) ------------------------------ */
  function setupInstallPrompt() {
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      showInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      const b = document.getElementById('install-btn');
      if (b) b.remove();
      U.toast('¡App instalada! 🎉', 'success');
    });

    function showInstallButton() {
      if (document.getElementById('install-btn')) return;
      const btn = U.el('button', {
        id: 'install-btn', class: 'install-btn', type: 'button',
        text: '⬇️ Instalar app',
      });
      btn.addEventListener('click', async () => {
        if (!deferred) return;
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') btn.remove();
        deferred = null;
      });
      document.body.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.App = window.App || {});
