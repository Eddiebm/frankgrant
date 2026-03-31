// FrankGrant — Navigation behaviors
document.addEventListener('DOMContentLoaded', function() {
  var hamburger = document.getElementById('nav-hamburger');
  var overlay = document.getElementById('nav-overlay');
  var overlayClose = document.getElementById('nav-overlay-close');

  if (hamburger && overlay) {
    hamburger.addEventListener('click', function() {
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      hamburger.setAttribute('aria-expanded', 'true');
    });
  }

  if (overlayClose && overlay) {
    overlayClose.addEventListener('click', function() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    });
  }

  // Close overlay on link click
  if (overlay) {
    overlay.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    }
  });

  // Active nav link based on current path
  var currentPath = window.location.pathname;
  var currentFile = currentPath.split('/').pop() || 'index.html';

  // Handle directory index pages
  if (currentPath.endsWith('/blog/') || currentPath.endsWith('/blog')) {
    currentFile = 'blog/index.html';
  }

  document.querySelectorAll('.nav-links a, .nav-overlay-links a').forEach(function(link) {
    var href = link.getAttribute('href') || '';

    // Normalize href
    var hrefFile = href.split('/').pop() || '';

    if (href === currentFile ||
        hrefFile === currentFile ||
        (currentFile === '' && href === 'index.html') ||
        (currentPath.includes('/blog/') && href.includes('blog'))) {
      link.classList.add('active');
    }
  });

  // Sticky nav shadow on scroll
  var nav = document.querySelector('.site-nav');
  if (nav) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 10) {
        nav.style.boxShadow = '0 2px 20px rgba(0,0,0,0.15)';
      } else {
        nav.style.boxShadow = '';
      }
    }, { passive: true });
  }
});
