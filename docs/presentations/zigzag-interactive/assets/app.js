// Zig-Zag interactive presentation: scroll-driven scenes, reveal-on-enter,
// keyboard navigation and a static fallback for reduced motion / small screens.
(function () {
  "use strict";

  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var smallQuery = window.matchMedia("(max-width: 860px)");
  var scenes = Array.prototype.slice.call(document.querySelectorAll(".scene"));
  var stickies = scenes.filter(function (s) { return s.classList.contains("sticky"); });
  var progressBar = document.querySelector(".progress");
  var hint = document.querySelector(".hint");
  var dotsNav = document.querySelector(".dots");
  var ticking = false;

  function isReduced() { return motionQuery.matches || params.get("motion") === "reduce"; }
  function isStatic() { return isReduced() || smallQuery.matches; }

  function applyMode() {
    root.classList.toggle("reduced", isReduced());
    root.classList.toggle("static", isStatic());
    measure();
    update();
  }

  // ---- catalog dots (moat scene) ----
  var catalog = document.querySelector("[data-fill]");
  var catalogDots = [];
  if (catalog) {
    var total = 16 * 9;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < total; i++) { var d = document.createElement("i"); frag.appendChild(d); catalogDots.push(d); }
    catalog.appendChild(frag);
  }

  // ---- roadmap horizontal shift ----
  var track = document.querySelector(".track");
  function measure() {
    if (!track) return;
    var overflow = Math.max(0, track.scrollWidth - window.innerWidth + 80);
    track.style.setProperty("--shift", String(overflow));
  }

  // ---- navigation dots ----
  scenes.forEach(function (scene, idx) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-label", scene.getAttribute("data-title") || "Sección " + (idx + 1));
    b.setAttribute("aria-label", "Ir a: " + (scene.getAttribute("data-title") || idx + 1));
    b.addEventListener("click", function () { goTo(scene.offsetTop); });
    dotsNav.appendChild(b);
  });
  var dotButtons = Array.prototype.slice.call(dotsNav.children);

  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  function sceneProgress(scene) {
    var span = scene.offsetHeight - window.innerHeight;
    if (span <= 0) return 1;
    return clamp((window.scrollY - scene.offsetTop) / span);
  }

  function setAt(scene, p) {
    var items = scene.querySelectorAll("[data-at]");
    for (var i = 0; i < items.length; i++) {
      var at = parseFloat(items[i].getAttribute("data-at"));
      items[i].classList.toggle("on", p >= at);
    }
  }

  function update() {
    ticking = false;
    var staticMode = isStatic();
    stickies.forEach(function (scene) {
      var p = staticMode ? 1 : sceneProgress(scene);
      scene.style.setProperty("--p", p.toFixed(4));
      setAt(scene, p);
      if (scene.id === "moat" && catalogDots.length) {
        var n = Math.round(catalogDots.length * (staticMode ? 0.62 : 0.08 + p * 0.62));
        for (var i = 0; i < catalogDots.length; i++) {
          catalogDots[i].classList.toggle("on", i < n);
          catalogDots[i].classList.toggle("fresh", i < n && i >= n - 6);
        }
      }
    });

    var max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.setProperty("--doc", max > 0 ? (window.scrollY / max).toFixed(4) : "0");

    var mid = window.scrollY + window.innerHeight * 0.4;
    var current = 0;
    scenes.forEach(function (s, i) { if (s.offsetTop <= mid) current = i; });
    dotButtons.forEach(function (b, i) { b.setAttribute("aria-current", i === current ? "true" : "false"); });
  }

  function onScroll() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    if (window.scrollY > 40 && hint) hint.classList.add("gone");
  }

  // ---- reveal on enter ----
  var revealables = document.querySelectorAll("[data-reveal]");
  var flows = document.querySelectorAll(".flow li");
  for (var f = 0; f < flows.length; f++) flows[f].style.setProperty("--i", f);
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    for (var r = 0; r < revealables.length; r++) io.observe(revealables[r]);
  } else {
    for (var q = 0; q < revealables.length; q++) revealables[q].classList.add("in");
  }

  // ---- keyboard navigation: stop points include sub-steps of sticky scenes ----
  function stops() {
    var out = [];
    scenes.forEach(function (scene) {
      var top = scene.offsetTop;
      var raw = scene.getAttribute("data-stops");
      if (raw && !isStatic()) {
        var span = scene.offsetHeight - window.innerHeight;
        raw.split(",").forEach(function (t) { out.push(Math.round(top + span * parseFloat(t))); });
      } else {
        out.push(top);
      }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function goTo(y) {
    window.scrollTo({ top: y, behavior: isReduced() ? "auto" : "smooth" });
  }

  function step(dir) {
    var list = stops();
    var y = window.scrollY;
    var target;
    if (dir > 0) { target = list.find(function (s) { return s > y + 4; }); }
    else { for (var i = list.length - 1; i >= 0; i--) { if (list[i] < y - 4) { target = list[i]; break; } } }
    if (target !== undefined) goTo(target);
  }

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(document.documentElement.scrollHeight); }
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { measure(); update(); });
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", applyMode);
  if (smallQuery.addEventListener) smallQuery.addEventListener("change", applyMode);

  applyMode();
})();
