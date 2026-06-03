// Highlight the table-of-contents entry for whichever section is in view.
// Lives in its own file (not an inline <script>) so it satisfies the app's
// Firebase Hosting CSP, which allows script-src 'self' but not unsafe-inline.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (l) { l.classList.remove('on'); });
      var a = byId[e.target.id];
      if (a) a.classList.add('on');
    });
  }, { rootMargin: '-18% 0px -72% 0px', threshold: 0 });
  document.querySelectorAll('main section[id]').forEach(function (s) { obs.observe(s); });
})();
