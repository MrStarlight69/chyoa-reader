// Apply saved theme before first paint (no flash).
try { var t = localStorage.getItem('cr:theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
