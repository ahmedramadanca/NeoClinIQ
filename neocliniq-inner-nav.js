(() => {
  const media = window.matchMedia('(max-width: 760px)');
  document.querySelectorAll('.nc-site-header .nc-global-nav').forEach((nav, i) => {
    const groups = [...nav.querySelectorAll('details')];
    const findGroup = name => groups.find(d => d.querySelector('summary')?.textContent.trim() === name);
    const add = (group, href, label) => {
      const menu = group?.querySelector('.nc-global-submenu');
      if (!menu || [...menu.querySelectorAll('a')].some(a => a.getAttribute('href') === href)) return;
      const a = document.createElement('a'); a.href = href; a.textContent = label; menu.append(a);
    };
    const resources = findGroup('Resources');
    if (resources) {
      resources.querySelector('summary').textContent = 'Resources';
      add(resources, '/masterclass-quiz/', 'Free Practice Quiz');
      add(resources, '/study-guide.html', 'PEBC Study Guide');
      add(resources, 'https://pebc.ca/general-informations/examination-dates-and-fees/', 'Official PEBC Exam Dates');
    }
    add(findGroup('About'), '/faq.html', 'FAQ');
    add(findGroup('PEBC OSCE'), '/osce-simulator.html', 'Open SI OSCE Tutor');
    if (!nav.querySelector('a[href="/mentorship.html"]')) {
      const a = document.createElement('a'); a.href = '/mentorship.html'; a.textContent = 'Mentorship';
      const about = findGroup('About'); if (about) about.before(a); else nav.append(a);
    }
    nav.querySelectorAll('a').forEach(a => {
      if (a.getAttribute('href') === location.pathname && !a.hash) a.setAttribute('aria-current','page');
    });
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
