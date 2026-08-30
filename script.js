/* AI Agent 概念学习中心 - 交互逻辑 */
(function () {
  "use strict";

  var PLACEHOLDER = "images/placeholder.png";
  var concepts = [];
  var activeCategory = "全部";
  var keyword = "";

  var grid = document.getElementById("grid");
  var empty = document.getElementById("empty");
  var filterBar = document.getElementById("filterBar");
  var searchInput = document.getElementById("searchInput");
  var countBadge = document.getElementById("countBadge");
  var backdrop = document.getElementById("modalBackdrop");

  /* ---------- 数据加载 ---------- */
  fetch("concepts.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      concepts = data;
      buildFilterBar();
      render();
    })
    .catch(function (e) {
      grid.innerHTML =
        '<div class="empty"><div class="empty-icon">⚠️</div><p>concepts.json 加载失败：' +
        e.message +
        '</p><p class="empty-hint">本地预览请运行 <code>python -m http.server</code> 后访问 localhost:8000</p></div>';
    });

  /* ---------- 分类过滤栏 ---------- */
  function buildFilterBar() {
    var counts = {};
    concepts.forEach(function (c) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    });
    var cats = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    });
    var frag = document.createDocumentFragment();
    ["全部"].concat(cats).forEach(function (cat, i) {
      var btn = document.createElement("button");
      btn.className = "chip" + (i === 0 ? " active" : "");
      btn.innerHTML =
        escapeHtml(cat) +
        ' <span class="num">' +
        (cat === "全部" ? concepts.length : counts[cat]) +
        "</span>";
      btn.addEventListener("click", function () {
        activeCategory = cat;
        filterBar.querySelectorAll(".chip").forEach(function (el) {
          el.classList.remove("active");
        });
        btn.classList.add("active");
        render();
      });
      frag.appendChild(btn);
    });
    filterBar.appendChild(frag);
  }

  /* ---------- 卡片渲染 ---------- */
  function visibleConcepts() {
    var kw = keyword.trim().toLowerCase();
    return concepts.filter(function (c) {
      var okCat = activeCategory === "全部" || c.category === activeCategory;
      var okKw =
        !kw ||
        (c.name + " " + c.description + " " + c.category)
          .toLowerCase()
          .indexOf(kw) !== -1;
      return okCat && okKw;
    });
  }

  function render() {
    var list = visibleConcepts();
    countBadge.textContent = list.length;
    empty.hidden = list.length > 0;
    grid.innerHTML = "";

    list.forEach(function (c, i) {
      var card = document.createElement("article");
      card.className = "card";
      card.style.animationDelay = Math.min(i * 0.03, 0.4) + "s";
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", c.name);

      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = c.name + " 示意图";
      img.src = c.image || PLACEHOLDER;
      img.addEventListener("error", function () {
        img.src = PLACEHOLDER;
      });

      var wrap = document.createElement("div");
      wrap.className = "card-img-wrap";
      wrap.appendChild(img);

      var body = document.createElement("div");
      body.className = "card-body";
      var title = document.createElement("h3");
      title.className = "card-title";
      title.textContent = c.name;
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = c.category;
      body.appendChild(title);
      body.appendChild(tag);

      card.appendChild(wrap);
      card.appendChild(body);
      card.addEventListener("click", function () {
        openModal(c);
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal(c);
        }
      });
      grid.appendChild(card);
    });
  }

  /* ---------- 搜索（实时） ---------- */
  searchInput.addEventListener("input", function () {
    keyword = searchInput.value;
    render();
  });

  /* ---------- 详情模态框 ---------- */
  function openModal(c) {
    var img = document.getElementById("modalImg");
    img.src = c.image || PLACEHOLDER;
    img.alt = c.name + " 示意图";
    img.onerror = function () {
      img.src = PLACEHOLDER;
    };
    document.getElementById("modalTag").textContent = c.category;
    document.getElementById("modalTitle").textContent = c.name;
    document.getElementById("modalDesc").textContent = c.description;
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
  }

  function closeModal() {
    backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  document.getElementById("modalClose").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }
})();
