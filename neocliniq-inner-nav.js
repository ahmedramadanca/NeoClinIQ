(() => {
  const media = window.matchMedia('(max-width: 760px)');
  document.querySelectorAll('.nc-site-header .nc-global-nav').forEach((nav, i) => {
    nav.id ||= 'nc-inner-navigation-' + (i + 1);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nc-mobile-menu-toggle';
    toggle.textContent = 'Menu';
    toggle.setAttribute('aria-controls', nav.id);
    nav.before(toggle);
    const setOpen = (open) => {
      nav.dataset.ncMobileCollapsed = String(media.matches && !open);
      toggle.setAttribute('aria-expanded', String(open));
      if (!open) nav.querySelectorAll('details[open]').forEach(item => { item.open = false; });
    };
    const sync = () => setOpen(!media.matches);
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !media.matches) return;
      setOpen(false);
      toggle.focus();
    });
    if (media.addEventListener) media.addEventListener('change', sync);
    else media.addListener(sync);
    sync();
  });
})();
