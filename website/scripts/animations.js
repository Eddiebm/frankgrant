// FrankGrant — Scroll animations and interactive behaviors
document.addEventListener('DOMContentLoaded', function() {

  // ── Scroll animations ──────────────────────────────────────────────
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.animate-on-scroll').forEach(function(el) {
      observer.observe(el);
    });
  } else {
    // Fallback: show all elements if IntersectionObserver not supported
    document.querySelectorAll('.animate-on-scroll').forEach(function(el) {
      el.classList.add('visible');
    });
  }

  // ── Study Section simulation ───────────────────────────────────────
  var simSection = document.querySelector('.simulation-section');
  if (simSection && 'IntersectionObserver' in window) {
    var simObserver = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        runSimulation();
        simObserver.disconnect();
      }
    }, { threshold: 0.3 });
    simObserver.observe(simSection);
  }

  function runSimulation() {
    var cards = document.querySelectorAll('.reviewer-card');
    var scoreEl = document.querySelector('.sim-score-value');
    var certEl = document.querySelector('.sim-certified');

    cards.forEach(function(card, i) {
      setTimeout(function() {
        card.classList.add('revealed');
      }, i * 800);
    });

    var totalDelay = (cards.length - 1) * 800 + 600;

    if (scoreEl) {
      setTimeout(function() {
        var targetScore = parseInt(scoreEl.getAttribute('data-target') || '24', 10);
        var current = 99;
        var step = Math.ceil((99 - targetScore) / 60);
        var timer = setInterval(function() {
          current -= step;
          if (current <= targetScore) {
            current = targetScore;
            clearInterval(timer);
            if (certEl) {
              certEl.style.opacity = '1';
              certEl.style.transition = 'opacity 0.5s ease';
            }
          }
          scoreEl.textContent = current;
        }, 33);
      }, totalDelay);
    }
  }

  // ── FAQ accordion ──────────────────────────────────────────────────
  document.querySelectorAll('.faq-question').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var item = this.closest('.faq-item');
      if (!item) return;
      var isOpen = item.classList.contains('open');

      // Close all siblings in same container
      var container = item.closest('.faq-items, .faq-list, .faq-group, .pricing-faq');
      if (container) {
        container.querySelectorAll('.faq-item.open').forEach(function(el) {
          el.classList.remove('open');
        });
      }

      if (!isOpen) item.classList.add('open');
    });
  });

  // Pricing FAQ accordion (uses different class names)
  document.querySelectorAll('.pricing-faq-question').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var item = this.closest('.pricing-faq-item');
      if (!item) return;
      var isOpen = item.classList.contains('open');

      var container = item.closest('.pricing-faq');
      if (container) {
        container.querySelectorAll('.pricing-faq-item.open').forEach(function(el) {
          el.classList.remove('open');
        });
      }

      if (!isOpen) item.classList.add('open');
    });
  });

  // ── Word counter ───────────────────────────────────────────────────
  document.querySelectorAll('[data-word-target]').forEach(function(textarea) {
    var counterId = textarea.getAttribute('data-word-target');
    var counter = document.getElementById(counterId);
    if (!counter) return;
    var min = parseInt(textarea.getAttribute('data-word-min') || '0', 10);

    function updateCount() {
      var words = textarea.value.trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
      counter.textContent = words + ' words';
      if (words === 0) { counter.className = 'word-counter'; return; }
      if (words < min) counter.className = 'word-counter warning';
      else counter.className = 'word-counter sufficient';
    }

    textarea.addEventListener('input', updateCount);
    updateCount();
  });

  // ── Smooth scroll for anchor links ────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
    anchor.addEventListener('click', function(e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── FAQ sidebar active state on scroll ────────────────────────────
  var faqGroups = document.querySelectorAll('.faq-group[id]');
  var faqNavLinks = document.querySelectorAll('.faq-nav a');

  if (faqGroups.length > 0 && faqNavLinks.length > 0 && 'IntersectionObserver' in window) {
    var faqGroupObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.getAttribute('id');
          faqNavLinks.forEach(function(link) {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + id) {
              link.classList.add('active');
            }
          });
        }
      });
    }, { rootMargin: '-20% 0px -60% 0px' });

    faqGroups.forEach(function(group) {
      faqGroupObserver.observe(group);
    });
  }

});
