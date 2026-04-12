(() => {
  const root = typeof self !== 'undefined' ? self : window;
  if (root.XTANCO_RUNTIME_CONFIG) return;
  root.XTANCO_RUNTIME_CONFIG = {
    elgato: {
      proxyPort: 9124,
      directIp: '',
      directPort: 9123,
    },
    hue: {
      bridgeIP: '',
      apiKey: '',
      lights: {
        despacho: 9,
        comedor: 8,
      },
      enabled: true,
    },
    telegram: {
      proxyPort: 9124,
      enabled: true,
      proxyUrl: 'https://admira-telegram-bridge.csilvasantin.workers.dev',
      polling: true,
      defaultChatId: '',
    },
    grok: {
      proxyPort: 9124,
      enabled: true,
      proxyUrl: 'https://admira-grok-proxy.csilvasantin.workers.dev',
      model: 'grok-4-latest',
    },
  };
})();
