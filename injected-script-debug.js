
    (() => {
      if (document.getElementById('orbit-immersive-container')) return;
      
      const container = document.createElement('div');
      container.id = 'orbit-immersive-container';
      container.style.setProperty('display', 'block', 'important');
      container.style.setProperty('visibility', 'visible', 'important');
      container.style.setProperty('opacity', '1', 'important');
      container.style.setProperty('position', 'fixed', 'important');
      container.style.setProperty('top', '0', 'important');
      container.style.setProperty('left', '0', 'important');
      container.style.setProperty('width', '100%', 'important');
      container.style.setProperty('height', '100%', 'important');
      container.style.setProperty('z-index', '2147483647', 'important');
      container.style.setProperty('pointer-events', 'none', 'important');
      
      const shadow = container.attachShadow({ mode: 'open' });
      
      const style = document.createElement('style');
      style.appendChild(document.createTextNode(
        '#float-btn { position: fixed; bottom: 24px; right: 24px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 255, 255, 0.75); border: 1px solid rgba(0, 0, 0, 0.08); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; color: #7c3aed; cursor: pointer; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); z-index: 2147483647; animation: float-pulse 3s infinite ease-in-out; pointer-events: auto !important; } ' +
        '#float-btn:hover { transform: scale(1.1); background: rgba(255, 255, 255, 0.9); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset; color: #6d28d9; } ' +
        '#float-btn:active { transform: scale(0.95); } ' +
        '@keyframes float-pulse { 0% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 0 rgba(124, 58, 237, 0.2); } 50% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 8px rgba(124, 58, 237, 0); } 100% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 0 rgba(124, 58, 237, 0); } } ' +
        '#overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(243, 244, 246, 0.7); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); z-index: 2147483646; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; pointer-events: none !important; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); } ' +
        '#overlay.show { opacity: 1; pointer-events: auto !important; } ' +
        '#search-box { width: 90%; max-width: 600px; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 20px; padding: 6px 18px; display: flex; align-items: center; gap: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.5) inset; transform: translateY(20px) scale(0.98); transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); } ' +
        '#overlay.show #search-box { transform: translateY(0) scale(1); } ' +
        '#search-box svg { color: #7c3aed; flex-shrink: 0; } ' +
        '#search-input { flex-grow: 1; background: transparent; border: none; outline: none; color: #1f2937; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; height: 48px; width: 100%; } ' +
        '#search-input::placeholder { color: #9ca3af; } ' +
        '#actions-row { display: flex; align-items: center; gap: 12px; margin-top: 20px; opacity: 0; transform: translateY(10px); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) 0.1s; } ' +
        '#overlay.show #actions-row { opacity: 1; transform: translateY(0); } ' +
        '.action-btn { background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); color: #4b5563; padding: 8px 16px; border-radius: 12px; font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.02); transition: all 0.2s; } ' +
        '.action-btn:hover { background: #7c3aed; color: #ffffff; border-color: #7c3aed; transform: translateY(-1px); } ' +
        '.action-btn.danger:hover { background: #ef4444; border-color: #ef4444; } ' +
        '.tip-text { font-size: 10px; color: #9ca3af; margin-top: 12px; font-family: inherit; opacity: 0; transition: opacity 0.3s ease 0.2s; } ' +
        '#overlay.show .tip-text { opacity: 1; }'
      ));
      shadow.appendChild(style);
      
      const floatBtn = document.createElement('div');
      floatBtn.id = 'float-btn';
      floatBtn.title = 'Open Search (Immersive Mode)';
      
      function createSearchIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "11");
        circle.setAttribute("cy", "11");
        circle.setAttribute("r", "8");
        svg.appendChild(circle);
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "21");
        line.setAttribute("y1", "21");
        line.setAttribute("x2", "16.65");
        line.setAttribute("y2", "16.65");
        svg.appendChild(line);
        
        return svg;
      }
      
      floatBtn.appendChild(createSearchIcon());
      shadow.appendChild(floatBtn);
      
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      
      const searchBox = document.createElement('div');
      searchBox.id = 'search-box';
      searchBox.appendChild(createSearchIcon());
      
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'search-input';
      searchInput.placeholder = 'Type URL or search query...';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchBox.appendChild(searchInput);
      
      const actionsRow = document.createElement('div');
      actionsRow.id = 'actions-row';
      
      const btnCloseOverlay = document.createElement('button');
      btnCloseOverlay.id = 'btn-close-overlay';
      btnCloseOverlay.className = 'action-btn';
      btnCloseOverlay.textContent = 'Close Search';
      actionsRow.appendChild(btnCloseOverlay);
      
      const btnExitImmersive = document.createElement('button');
      btnExitImmersive.id = 'btn-exit-immersive';
      btnExitImmersive.className = 'action-btn danger';
      btnExitImmersive.textContent = 'Exit Immersive Mode';
      actionsRow.appendChild(btnExitImmersive);
      
      const tipText = document.createElement('div');
      tipText.className = 'tip-text';
      tipText.textContent = 'Press Enter to navigate • Esc to exit full screen';
      
      overlay.appendChild(searchBox);
      overlay.appendChild(actionsRow);
      overlay.appendChild(tipText);
      shadow.appendChild(overlay);
      
      const openSearch = () => {
        overlay.classList.add('show');
        console.log('orbit-action:search-open');
        setTimeout(() => searchInput.focus(), 50);
      };
      
      const closeSearch = () => {
        overlay.classList.remove('show');
        console.log('orbit-action:search-close');
        searchInput.value = '';
      };
      
      const exitImmersive = () => {
        console.log('orbit-action:exit-immersive');
      };
      
      floatBtn.addEventListener('click', () => {
        if (overlay.classList.contains('show')) {
          closeSearch();
        } else {
          openSearch();
        }
      });
      btnCloseOverlay.addEventListener('click', closeSearch);
      btnExitImmersive.addEventListener('click', exitImmersive);
      
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          let query = searchInput.value.trim();
          if (query) {
            let targetUrl = query;
            if (!query.includes('.') && !query.startsWith('http') && !query.startsWith('file://')) {
              targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
            } else if (!query.startsWith('http://') && !query.startsWith('https://') && !query.startsWith('file://')) {
              targetUrl = 'https://' + query;
            }
            closeSearch();
            window.location.href = targetUrl;
          }
        } else if (e.key === 'Escape') {
          closeSearch();
          e.stopPropagation();
        }
      });
      
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (overlay.classList.contains('show')) {
            closeSearch();
          } else {
            exitImmersive();
          }
        }
      }, true);
      
      const appendToTarget = () => {
        try {
          const targetParent = document.fullscreenElement || document.documentElement;
          if (container.parentElement !== targetParent && targetParent) {
            targetParent.appendChild(container);
          }
        } catch (err) {}
      };
      
      appendToTarget();
      
      document.addEventListener('fullscreenchange', appendToTarget);
      
      const observer = new MutationObserver(() => {
        const targetParent = document.fullscreenElement || document.documentElement;
        if (container.parentElement !== targetParent && targetParent) {
          appendToTarget();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    })();
  