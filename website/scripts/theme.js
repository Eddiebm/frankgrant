// FrankGrant — Theme Management
(function() {
  // Apply theme immediately to prevent flash
  var saved = localStorage.getItem('frankgrant-theme');
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (systemDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

function initTheme() {
  var saved = localStorage.getItem('frankgrant-theme');
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (systemDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateToggleIcon(theme);
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('frankgrant-theme', next);
  updateToggleIcon(next);
}

function updateToggleIcon(theme) {
  document.querySelectorAll('.theme-toggle').forEach(function(btn) {
    btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initTheme();
  document.querySelectorAll('.theme-toggle').forEach(function(btn) {
    btn.addEventListener('click', toggleTheme);
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    if (!localStorage.getItem('frankgrant-theme')) {
      var theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      updateToggleIcon(theme);
    }
  });
});
