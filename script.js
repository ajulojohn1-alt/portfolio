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

// Cookie notice & Microsoft Clarity consent management
const cookieBar = document.getElementById('cookieBar');
const savedCookieChoice = localStorage.getItem('ajuloCookieChoice');

if (cookieBar && !savedCookieChoice) {
    cookieBar.hidden = false;
}

// Pass stored consent preference to Clarity if available
if (savedCookieChoice) {
    if (typeof window.clarity === 'function') {
        window.clarity('consent', savedCookieChoice === 'yes');
    }
}

document.querySelectorAll('[data-cookie-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
        const choice = btn.dataset.cookieChoice;
        localStorage.setItem('ajuloCookieChoice', choice);
        if (typeof window.clarity === 'function') {
            window.clarity('consent', choice === 'yes');
        }
        if (cookieBar) cookieBar.hidden = true;
    });
});

// Two-click YouTube loader
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

// LAZY LOAD IFRAME (Fixes PageSpeed TBT)
document.addEventListener("DOMContentLoaded", function() {
    const iframes = document.querySelectorAll('.lazy-iframe');
    if (iframes.length > 0) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.src = entry.target.dataset.src;
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '300px' });
        iframes.forEach(iframe => observer.observe(iframe));
    }
});