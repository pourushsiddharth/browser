/**
 * Window controls, reader mode, collapse chrome, and immersive mode bindings
 */
export function initControls({ api, activeTabGetter }) {
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');

  if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
      api.send('window-minimize');
    });
  }

  if (btnMaximize) {
    btnMaximize.addEventListener('click', () => {
      api.send('window-maximize');
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      api.send('window-close');
    });
  }

  // Window maximized status sync
  api.on('window-maximized-status', (isMaximized) => {
    if (btnMaximize) {
      if (isMaximized) {
        btnMaximize.classList.add('maximized');
        btnMaximize.title = 'Restore';
      } else {
        btnMaximize.classList.remove('maximized');
        btnMaximize.title = 'Maximize';
      }
    }
  });

  // Escape key fallback listener for immersive mode
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeId = activeTabGetter();
      if (document.body.classList.contains('immersive-mode') && activeId) {
        api.send('toggle-immersive-mode', activeId);
      }
    }
  });
}
