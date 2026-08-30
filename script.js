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
        escapeHtml(e.message) +
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
      var haystack = [
        c.name, c.summary, c.description, c.category,
        c.analogy || "", c.background || "", c.problem || "",
        (c.points || []).join(" "),
        (c.pitfalls || []).join(" "),
        (c.applications || []).join(" "),
        c.extended || "",
      ].join(" ");
      var okCat = activeCategory === "全部" || c.category === activeCategory;
      var okKw = !kw || haystack.toLowerCase().indexOf(kw) !== -1;
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

      var wrap = document.createElement("div");
      wrap.className = "card-img-wrap";
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = c.name + " 示意图";
      img.src = c.image || PLACEHOLDER;
      img.addEventListener("error", function () {
        img.src = PLACEHOLDER;
      });
      wrap.appendChild(img);

      var body = document.createElement("div");
      body.className = "card-body";
      var title = document.createElement("h3");
      title.className = "card-title";
      title.textContent = c.name;
      var desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = c.summary || c.description;
      var meta = document.createElement("div");
      meta.className = "card-meta";
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = c.category;
      var learn = document.createElement("span");
      learn.className = "learn-hint";
      learn.textContent = "学习 →";
      meta.appendChild(tag);
      meta.appendChild(learn);
      body.appendChild(title);
      body.appendChild(desc);
      body.appendChild(meta);

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

    var body = document.getElementById("modalBody");
    body.innerHTML = "";

    body.appendChild(section("📄", "是什么", para(c.description)));

    if (c.background) {
      body.appendChild(section("🌱", "背景与动机", para(c.background)));
    }

    if (c.problem) {
      var probBox = document.createElement("div");
      probBox.className = "problem-box";
      probBox.appendChild(para(c.problem));
      body.appendChild(section("🎯", "解决什么问题", probBox));
    }

    if (c.analogy) {
      var analogyBox = document.createElement("div");
      analogyBox.className = "analogy-box";
      analogyBox.appendChild(para(c.analogy));
      body.appendChild(section("💡", "打个比方", analogyBox));
    }

    if (c.points && c.points.length) {
      body.appendChild(section("📌", "核心要点", bulletList(c.points, "points-list")));
    }

    if (c.pitfalls && c.pitfalls.length) {
      body.appendChild(section("⚠️", "常见误区", bulletList(c.pitfalls, "pitfall-list")));
    }

    if (c.applications && c.applications.length) {
      body.appendChild(section("🏢", "实际应用场景", bulletList(c.applications, "app-list")));
    }

    if (c.example && (c.example.code || c.example.scenario)) {
      var ex = c.example;
      var box = document.createElement("div");
      box.className = "example-box";
      if (ex.scenario) {
        var sc = document.createElement("p");
        sc.className = "scenario";
        sc.textContent = ex.scenario;
        box.appendChild(sc);
      }
      if (ex.code) {
        var pre = document.createElement("pre");
        pre.className = "code-block";
        var code = document.createElement("code");
        code.textContent = ex.code;
        pre.appendChild(code);
        if (ex.lang) {
          var lang = document.createElement("span");
          lang.className = "lang-badge";
          lang.textContent = ex.lang;
          pre.appendChild(lang);
        }
        box.appendChild(pre);
      }
      body.appendChild(section("💻", "实例", box));
    }

    if (c.extended || (c.related && c.related.length)) {
      var nav = document.createElement("div");
      nav.className = "extended-box";
      if (c.extended) {
        var ext = document.createElement("p");
        ext.className = "extended-text";
        ext.textContent = c.extended;
        nav.appendChild(ext);
      }
      if (c.related && c.related.length) {
        var chips = document.createElement("div");
        chips.className = "related-chips";
        c.related.forEach(function (rid) {
          var target = concepts.find(function (x) {
            return x.id === rid;
          });
          if (!target) return;
          var chip = document.createElement("button");
          chip.className = "related-chip";
          chip.textContent = "→ " + target.name;
          chip.addEventListener("click", function () {
            openModal(target);
            document.querySelector(".modal").scrollTo(0, 0);
          });
          chips.appendChild(chip);
        });
        nav.appendChild(chips);
      }
      body.appendChild(section("🧭", "延伸学习", nav));
    }

    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
  }

  function bulletList(items, cls) {
    var ul = document.createElement("ul");
    ul.className = cls;
    items.forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    return ul;
  }

  function section(icon_, title, contentEl) {
    var sec = document.createElement("section");
    sec.className = "modal-section";
    var h3 = document.createElement("h3");
    h3.className = "section-title";
    h3.textContent = icon_ + " " + title;
    sec.appendChild(h3);
    sec.appendChild(contentEl);
    return sec;
  }

  function para(text) {
    var p = document.createElement("p");
    p.textContent = text;
    return p;
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

  /* ==========================================================
     教程系统：实战项目 / 论文精读
     ========================================================== */
  var tutorials = [];
  var currentView = "concepts";
  var grid = document.getElementById("grid");
  var filterBarWrap = document.getElementById("filterBarWrap");
  var tutorialList = document.getElementById("tutorialList");
  var readerBackdrop = document.getElementById("readerBackdrop");
  var readerContent = document.getElementById("readerContent");

  fetch("tutorials.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      tutorials = data.tutorials || [];
      if (currentView !== "concepts") renderTutorialList(currentView);
    })
    .catch(function () {
      tutorials = [];
    });

  /* ---------- 视图切换 ---------- */
  document.querySelectorAll(".view-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var view = btn.dataset.view;
      if (view === currentView) return;
      currentView = view;
      document.querySelectorAll(".view-tab").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      var isConcept = view === "concepts";
      filterBarWrap.hidden = !isConcept;
      grid.hidden = !isConcept;
      empty.hidden = true;
      tutorialList.hidden = isConcept;
      if (!isConcept) {
        grid.hidden = true;
        renderTutorialList(view);
      }
    });
  });

  /* ---------- 教程列表 ---------- */
  function renderTutorialList(view) {
    var type = view === "projects" ? "project" : "paper";
    var list = tutorials.filter(function (t) {
      return t.type === type;
    });
    tutorialList.innerHTML = "";
    if (!list.length) {
      tutorialList.innerHTML =
        '<div class="empty"><div class="empty-icon">⚠️</div><p>tutorials.json 加载失败或为空</p></div>';
      return;
    }
    list.forEach(function (t, i) {
      var card = document.createElement("article");
      card.className = "tutorial-card";
      card.style.animationDelay = Math.min(i * 0.06, 0.3) + "s";

      var badge = document.createElement("span");
      badge.className = "tc-badge";
      badge.textContent = t.type === "paper" ? "📜 论文精读" : "🛠️ 实战项目";

      var title = document.createElement("h3");
      title.className = "tc-title";
      title.textContent = t.title;

      var sub = document.createElement("p");
      sub.className = "tc-sub";
      sub.textContent = t.subtitle;

      var intro = document.createElement("p");
      intro.className = "tc-intro";
      intro.textContent = t.intro;

      var meta = document.createElement("div");
      meta.className = "tc-meta";
      var m1 = document.createElement("span");
      m1.textContent = "⏱ " + t.readTime;
      var m2 = document.createElement("span");
      m2.textContent = "📑 " + t.meta;
      var go = document.createElement("span");
      go.className = "tc-go";
      go.textContent = "开始阅读 →";
      meta.appendChild(m1);
      meta.appendChild(m2);
      meta.appendChild(go);

      card.appendChild(badge);
      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(intro);
      card.appendChild(meta);
      card.addEventListener("click", function () {
        openTutorial(t);
      });
      tutorialList.appendChild(card);
    });
  }

  /* ---------- 教程阅读器 ---------- */
  function openTutorial(t) {
    readerContent.innerHTML = "";

    var head = document.createElement("header");
    head.className = "reader-head";
    var h1 = document.createElement("h1");
    h1.textContent = t.title;
    var sub = document.createElement("p");
    sub.className = "reader-sub";
    sub.textContent = t.subtitle;
    var meta = document.createElement("p");
    meta.className = "reader-meta";
    meta.textContent = t.meta + " · " + t.readTime;
    var intro = document.createElement("p");
    intro.className = "reader-intro";
    intro.textContent = t.intro;
    if (t.link) {
      var link = document.createElement("a");
      link.className = "reader-link";
      link.href = t.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "📄 查看论文原文（arXiv）↗";
      head.appendChild(link);
    }
    head.appendChild(h1);
    head.appendChild(sub);
    head.appendChild(meta);
    head.appendChild(intro);
    readerContent.appendChild(head);

    // 顶部目录
    var toc = document.createElement("nav");
    toc.className = "reader-toc";
    t.sections.forEach(function (s, i) {
      var item = document.createElement("a");
      item.href = "#sec-" + i;
      item.textContent = s.title;
      toc.appendChild(item);
    });
    readerContent.appendChild(toc);

    t.sections.forEach(function (s, i) {
      var sec = document.createElement("section");
      sec.className = "reader-section";
      sec.id = "sec-" + i;
      var h2 = document.createElement("h2");
      h2.textContent = s.title;
      sec.appendChild(h2);
      s.blocks.forEach(function (b) {
        sec.appendChild(renderBlock(b));
      });
      readerContent.appendChild(sec);
    });

    readerBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    document.querySelector(".reader").scrollTo(0, 0);
    document.getElementById("readerClose").focus();
  }

  function renderBlock(b) {
    switch (b.type) {
      case "text": {
        var p = document.createElement("p");
        p.className = "tb-text";
        p.textContent = b.content;
        return p;
      }
      case "list": {
        var ul = document.createElement("ul");
        ul.className = "tb-list";
        b.items.forEach(function (it) {
          var li = document.createElement("li");
          li.textContent = it;
          ul.appendChild(li);
        });
        return ul;
      }
      case "steps": {
        var ol = document.createElement("ol");
        ol.className = "tb-steps";
        b.items.forEach(function (it) {
          var li = document.createElement("li");
          li.textContent = it;
          ol.appendChild(li);
        });
        return ol;
      }
      case "callout": {
        var div = document.createElement("div");
        div.className = "tb-callout tone-" + (b.tone || "info");
        var strong = document.createElement("strong");
        strong.textContent = b.title;
        var cp = document.createElement("p");
        cp.textContent = b.content;
        div.appendChild(strong);
        div.appendChild(cp);
        return div;
      }
      case "quote": {
        var fig = document.createElement("figure");
        fig.className = "tb-quote";
        var src = document.createElement("figcaption");
        src.textContent = "— " + b.source;
        var en = document.createElement("p");
        en.className = "q-en";
        en.textContent = b.en;
        fig.appendChild(en);
        if (b.zh) {
          var zh = document.createElement("p");
          zh.className = "q-zh";
          zh.textContent = "译文：" + b.zh;
          fig.appendChild(zh);
        }
        fig.appendChild(src);
        return fig;
      }
      case "formula": {
        var f = document.createElement("div");
        f.className = "tb-formula";
        var fn = document.createElement("div");
        fn.className = "f-name";
        fn.textContent = b.name;
        var fe = document.createElement("div");
        fe.className = "f-expr";
        fe.textContent = b.expr;
        var fx = document.createElement("p");
        fx.className = "f-explain";
        fx.textContent = b.explain;
        f.appendChild(fn);
        f.appendChild(fe);
        f.appendChild(fx);
        return f;
      }
      case "code": {
        var pre = document.createElement("pre");
        pre.className = "code-block";
        var code = document.createElement("code");
        code.textContent = b.content;
        pre.appendChild(code);
        if (b.lang) {
          var lang = document.createElement("span");
          lang.className = "lang-badge";
          lang.textContent = b.lang;
          pre.appendChild(lang);
        }
        return pre;
      }
      case "diagram": {
        var dpre = document.createElement("pre");
        dpre.className = "tb-diagram";
        dpre.textContent = b.content;
        return dpre;
      }
      case "table": {
        var table = document.createElement("table");
        table.className = "tb-table";
        var thead = document.createElement("thead");
        var trh = document.createElement("tr");
        b.head.forEach(function (h) {
          var th = document.createElement("th");
          th.textContent = h;
          trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        b.rows.forEach(function (row) {
          var tr = document.createElement("tr");
          row.forEach(function (cell) {
            var td = document.createElement("td");
            td.textContent = cell;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
      }
      case "concepts": {
        var wrap = document.createElement("div");
        wrap.className = "tb-concepts";
        var lead = document.createElement("div");
        lead.className = "tc-lead";
        lead.textContent = b.lead || "相关概念：";
        var chips = document.createElement("div");
        chips.className = "related-chips";
        (b.ids || []).forEach(function (cid) {
          var target = concepts.find(function (x) {
            return x.id === cid;
          });
          if (!target) return;
          var chip = document.createElement("button");
          chip.className = "related-chip";
          chip.textContent = "→ " + target.name;
          chip.addEventListener("click", function () {
            openModal(target);
          });
          chips.appendChild(chip);
        });
        wrap.appendChild(lead);
        wrap.appendChild(chips);
        return wrap;
      }
      default: {
        var fallback = document.createElement("p");
        fallback.className = "tb-text";
        fallback.textContent = JSON.stringify(b);
        return fallback;
      }
    }
  }

  function closeTutorial() {
    readerBackdrop.hidden = true;
    document.body.style.overflow = "";
  }

  document.getElementById("readerClose").addEventListener("click", closeTutorial);
  readerBackdrop.addEventListener("click", function (e) {
    if (e.target === readerBackdrop) closeTutorial();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !readerBackdrop.hidden) closeTutorial();
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
