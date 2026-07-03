/* =============================================================================
 * e5-integrations.js — ETAPA 5 · Punto 17: Arquitectura para futuras integraciones
 * -----------------------------------------------------------------------------
 * NO implementa ninguna integración real. Solo deja la ARQUITECTURA lista: un
 * registro de "adaptadores" con interfaz uniforme, para que en el futuro se pueda
 * enchufar ERP, facturación, APIs de proveedores, Mercado Libre, WhatsApp
 * Business API, CRM o sincronización multi-sucursal SIN reestructurar el proyecto.
 *
 * Patrón: Adapter + Registry. Cada integración futura se registra con
 *   App.E5.Integrations.register(adapter)
 * donde `adapter` cumple el contrato IntegrationAdapter (ver abajo). La app
 * núcleo nunca llama a una integración directamente: pasa por este registro.
 *
 * Contrato IntegrationAdapter:
 *   {
 *     id:        'mercadolibre',            // único
 *     name:      'Mercado Libre',
 *     category:  'marketplace',             // erp|billing|supplier|marketplace|messaging|crm|sync
 *     version:   '0.0.0',
 *     enabled:   false,
 *     capabilities: ['publish','sync-stock','sync-price'],
 *     // Ciclo de vida (todas opcionales, async):
 *     init(ctx)        {}                   // ctx = { Store, E5, config }
 *     test()           {}                   // prueba de conexión -> {ok, msg}
 *     // Hooks de dominio que la integración PUEDE escuchar:
 *     onProductChange(product) {}
 *     onPriceChange(product, oldPrice) {}
 *     onOrder(order) {}
 *   }
 *
 * API pública:
 *   App.E5.Integrations.register(adapter)
 *   App.E5.Integrations.get(id) / .list() / .byCategory(cat)
 *   App.E5.Integrations.enable(id) / .disable(id)
 *   App.E5.Integrations.dispatch(hookName, ...args)   // notifica a los habilitados
 *   App.E5.Integrations.config(id)                    // lee config persistida (KV)
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;
  const adapters = {};
  const cfgStore = E5.coll('integration_config'); // persistencia de config/enabled

  // Catálogo declarativo de integraciones PREVISTAS (placeholders, no activas).
  const PLANNED = [
    { id: 'erp', name: 'ERP', category: 'erp', capabilities: ['sync-stock', 'sync-products'] },
    { id: 'billing', name: 'Facturación', category: 'billing', capabilities: ['invoice'] },
    { id: 'supplier_api', name: 'API de Proveedores', category: 'supplier', capabilities: ['import-price', 'import-stock'] },
    { id: 'mercadolibre', name: 'Mercado Libre', category: 'marketplace', capabilities: ['publish', 'sync-stock', 'sync-price'] },
    { id: 'whatsapp_business', name: 'WhatsApp Business API', category: 'messaging', capabilities: ['send', 'catalog'] },
    { id: 'crm', name: 'CRM', category: 'crm', capabilities: ['contacts', 'leads'] },
    { id: 'multi_branch', name: 'Sincronización Multi-sucursal', category: 'sync', capabilities: ['sync-all'] },
  ];

  function register(adapter) {
    if (!adapter || !adapter.id) throw new Error('Adapter sin id');
    adapters[adapter.id] = Object.assign(
      { version: '0.0.0', enabled: false, capabilities: [], category: 'misc' },
      adapter
    );
    return adapters[adapter.id];
  }

  function get(id) { return adapters[id]; }
  function list() { return Object.values(adapters); }
  function byCategory(cat) { return list().filter((a) => a.category === cat); }

  async function enable(id) {
    const a = adapters[id]; if (!a) return false;
    a.enabled = true;
    await persist(id, { enabled: true });
    if (typeof a.init === 'function') { try { await a.init({ Store: App.Store, E5: App.E5, config: await config(id) }); } catch (e) { console.warn('[E5.Int]', id, e); } }
    return true;
  }
  async function disable(id) {
    const a = adapters[id]; if (!a) return false;
    a.enabled = false;
    await persist(id, { enabled: false });
    return true;
  }

  /** Notifica un hook a todas las integraciones habilitadas que lo implementen. */
  async function dispatch(hookName) {
    const args = Array.prototype.slice.call(arguments, 1);
    const results = [];
    for (const a of list()) {
      if (a.enabled && typeof a[hookName] === 'function') {
        try { results.push(await a[hookName].apply(a, args)); }
        catch (e) { console.warn('[E5.Int dispatch]', a.id, hookName, e); }
      }
    }
    return results;
  }

  /* ---- Persistencia de config por integración (KV) ----------------------- */
  async function config(id) {
    const all = await cfgStore.list();
    return all.find((c) => c.id === id) || { id, enabled: false, settings: {} };
  }
  async function persist(id, patch) {
    const cur = await config(id);
    const merged = Object.assign(cur, patch, { id });
    await cfgStore.put(merged);
    return merged;
  }
  async function saveSettings(id, settings) {
    const cur = await config(id);
    cur.settings = Object.assign(cur.settings || {}, settings || {});
    await cfgStore.put(cur);
    return cur;
  }

  // Registra los placeholders PREVISTOS como adaptadores deshabilitados, para
  // que aparezcan en el panel "Integraciones" como "próximamente".
  PLANNED.forEach((p) => register(Object.assign({ planned: true }, p)));

  App.E5.Integrations = {
    register, get, list, byCategory, enable, disable, dispatch,
    config, saveSettings, PLANNED,
  };
})(window.App = window.App || {});
