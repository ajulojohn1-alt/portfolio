// Mobile nav
const menuToggle = document.querySelector('.menu-toggle');
const navMenu = document.getElementById('nav-menu');
if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('open');
        menuToggle.setAttribute('aria-expanded', isOpen);
    });
    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('open');
            menuToggle.setAttribute('aria-expanded', 'false');
        });
    });
}

// Reveal on scroll
const revealElements = document.querySelectorAll('.reveal');
if (revealElements.length) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });
    revealElements.forEach(el => observer.observe(el));
}

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Cookie notice
const cookieBar = document.getElementById('cookieBar');
if (cookieBar && !localStorage.getItem('ajuloCookieChoice')) {
    cookieBar.hidden = false;
}
document.querySelectorAll('[data-cookie-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
        localStorage.setItem('ajuloCookieChoice', btn.dataset.cookieChoice);
        if (cookieBar) cookieBar.hidden = true;
    });
});

// Two-click YouTube loader (PECR-friendly: video only loads on explicit click)
document.querySelectorAll('.video-screen').forEach(screen => {
    const btn = screen.querySelector('.video-load');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const iframe = document.createElement('iframe');
        iframe.src = screen.dataset.video;
        iframe.title = btn.dataset.title || 'Video';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.allowFullscreen = true;
        screen.innerHTML = '';
        screen.appendChild(iframe);
    });
});