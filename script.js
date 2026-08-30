/* AI Agent 概念学习中心 - 交互逻辑 */
(function () {
  "use strict";

  var PLACEHOLDER = "images/placeholder.webp";
  var concepts = [];
  var activeCategory = "全部";
  var keyword = "";

  var grid = document.getElementById("grid");
  var empty = document.getElementById("empty");
  var filterBar = document.getElementById("filterBar");
  var searchInput = document.getElementById("searchInput");
  var countBadge = document.getElementById("countBadge");
  var learnedBadge = document.getElementById("learnedBadge");
  var reviewView = document.getElementById("reviewView");
  var backdrop = document.getElementById("modalBackdrop");

  /* ---------- 学习进度（localStorage + Leitner 间隔重复） ---------- */
  var PROG_KEY = "ail_progress_v1";
  var INTERVALS_D = [0, 1, 3, 7, 14, 30]; // box 1~5 对应的复习间隔（天）
  var DAY_MS = 86400000;
  var prog = loadProg();

  function loadProg() {
    try {
      return JSON.parse(localStorage.getItem(PROG_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveProg() {
    try {
      localStorage.setItem(PROG_KEY, JSON.stringify(prog));
    } catch (e) { /* 隐私模式等场景下静默降级 */ }
  }
  function isLearned(id) {
    return !!(prog[id] && prog[id].box > 0);
  }
  function learnedCount() {
    return concepts.filter(function (c) {
      return isLearned(c.id);
    }).length;
  }
  function dueCount() {
    var now = Date.now();
    return concepts.filter(function (c) {
      return prog[c.id] && prog[c.id].box > 0 && prog[c.id].due <= now;
    }).length;
  }
  function setLearned(id, learned) {
    if (learned) {
      prog[id] = prog[id] || { box: 0, due: 0 };
      prog[id].box = Math.max(prog[id].box, 1);
      prog[id].due = Date.now() + INTERVALS_D[prog[id].box] * DAY_MS;
    } else {
      delete prog[id];
    }
    saveProg();
    updateLearnedBadge();
    refreshCardLearnState(id);
  }
  function updateLearnedBadge() {
    if (!concepts.length) return;
    learnedBadge.textContent = "已学 " + learnedCount() + "/" + concepts.length;
  }
  function refreshCardLearnState(id) {
    var btn = grid.querySelector('.card-learn[data-id="' + id + '"]');
    if (btn) {
      var card = btn.closest(".card");
      card.classList.toggle("learned", isLearned(id));
      btn.textContent = isLearned(id) ? "✓" : "☆";
    }
  }

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
      updateLearnedBadge();
      if (++dataReady === 2) applyRoute();
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
      img.decoding = "async";
      img.alt = c.name + " 示意图";
      img.src = c.image || PLACEHOLDER;
      img.addEventListener("error", function () {
        img.src = PLACEHOLDER;
      });
      wrap.appendChild(img);

      var learnBtn = document.createElement("button");
      learnBtn.className = "card-learn";
      learnBtn.dataset.id = c.id;
      learnBtn.textContent = isLearned(c.id) ? "✓" : "☆";
      learnBtn.title = isLearned(c.id) ? "取消已学标记" : "标记为已学";
      learnBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        setLearned(c.id, !isLearned(c.id));
      });
      wrap.appendChild(learnBtn);
      if (isLearned(c.id)) card.classList.add("learned");

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
  function openModal(c, opts) {
    openConceptId = c.id;
    var img = document.getElementById("modalImg");
    img.src = c.image || PLACEHOLDER;
    img.alt = c.name + " 示意图";
    img.onerror = function () {
      img.src = PLACEHOLDER;
    };
    document.getElementById("modalTag").textContent = c.category;
    document.getElementById("modalTitle").textContent = c.name;
    var learnBtn = document.getElementById("modalLearn");
    learnBtn.textContent = isLearned(c.id) ? "✓ 已学" : "☆ 标记已学";
    learnBtn.classList.toggle("on", isLearned(c.id));
    learnBtn.onclick = function () {
      setLearned(c.id, !isLearned(c.id));
      learnBtn.textContent = isLearned(c.id) ? "✓ 已学" : "☆ 标记已学";
      learnBtn.classList.toggle("on", isLearned(c.id));
    };

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
          var chip = document.createElement("button");
          chip.className = "related-chip";
          var target = concepts.find(function (x) {
            return x.id === rid;
          });
          if (target) {
            chip.textContent = "→ " + target.name;
            chip.addEventListener("click", function () {
              openModal(target);
              document.querySelector(".modal").scrollTo(0, 0);
            });
          } else {
            var tut = tutorials.find(function (x) {
              return x.id === rid;
            });
            if (!tut) return;
            chip.textContent = "📄 " + tut.title;
            chip.addEventListener("click", function () {
              closeModal();
              openTutorial(tut);
            });
          }
          chips.appendChild(chip);
        });
        nav.appendChild(chips);
      }
      body.appendChild(section("🧭", "延伸学习", nav));
    }

    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
    syncHash("concept=" + c.id, opts);
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

  var openConceptId = null;
  var openTutorialId = null;

  function closeModal(opts) {
    backdrop.hidden = true;
    openConceptId = null;
    document.body.style.overflow = "";
    syncHash("", opts);
  }

  document.getElementById("modalClose").addEventListener("click", function () {
    closeModal();
  });
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });

  /* ==========================================================
     hash 路由：#concept=<id> / #tutorial=<id> / #projects 等
     ========================================================== */
  var lastAppliedHash = null;

  function currentHash() {
    return decodeURIComponent((location.hash || "").replace(/^#\/?/, ""));
  }

  function syncHash(h, opts) {
    if (opts && opts.fromRoute) return;
    if (h === currentHash()) {
      lastAppliedHash = h;
      return;
    }
    lastAppliedHash = h;
    if (!h) {
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      location.hash = h;
    }
  }

  function applyHash(h) {
    lastAppliedHash = h;
    var parts = {};
    h.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
      else if (kv) parts[kv] = "1";
    });

    var view = parts.view ||
      (parts.projects ? "projects" : parts.paper ? "paper" :
        parts.review ? "review" : null);
    if (view && view !== currentView) switchTo(view, { fromRoute: true });

    if (parts.concept) {
      var c = concepts.find(function (x) {
        return x.id === parts.concept;
      });
      if (c && openConceptId !== c.id) openModal(c, { fromRoute: true });
    } else if (!backdrop.hidden) {
      closeModal({ fromRoute: true });
    }

    if (parts.tutorial) {
      var t = tutorials.find(function (x) {
        return x.id === parts.tutorial;
      });
      if (t && openTutorialId !== t.id) openTutorial(t, { fromRoute: true });
    } else if (!readerBackdrop.hidden && !parts.concept) {
      closeTutorial({ fromRoute: true });
    }
  }

  function applyRoute() {
    applyHash(currentHash());
  }

  window.addEventListener("hashchange", function () {
    var h = currentHash();
    if (h === lastAppliedHash) return; // 自己设置的 hash，已渲染
    applyHash(h);
  });

  /* ==========================================================
     自测复习：闪卡 + Leitner 间隔重复
     ========================================================== */
  var review = { queue: [], idx: 0, flipped: false, yes: 0, no: 0 };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildQueue() {
    var now = Date.now();
    var due = shuffle(concepts.filter(function (c) {
      return prog[c.id] && prog[c.id].box > 0 && prog[c.id].due <= now;
    }));
    var fresh = shuffle(concepts.filter(function (c) {
      return !prog[c.id];
    }));
    return due.concat(fresh).slice(0, 20);
  }

  function startReview() {
    review.queue = buildQueue();
    review.idx = 0;
    review.flipped = false;
    review.yes = 0;
    review.no = 0;
    renderReview();
  }

  function gradeCard(good) {
    var c = review.queue[review.idx];
    if (!c) return;
    var p = prog[c.id] || { box: 0, due: 0 };
    if (good) {
      p.box = Math.min(p.box + 1, INTERVALS_D.length - 1);
      p.due = Date.now() + INTERVALS_D[p.box] * DAY_MS;
      review.yes++;
    } else {
      p.box = 1;
      p.due = Date.now();
      review.queue.push(c); // 本轮结尾再来一次
      review.no++;
    }
    prog[c.id] = p;
    saveProg();
    updateLearnedBadge();
    refreshCardLearnState(c.id);
    review.idx++;
    review.flipped = false;
    renderReview();
  }

  function rvEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderReview() {
    reviewView.innerHTML = "";
    var L = learnedCount();
    var D = dueCount();
    var stats = rvEl("div", "review-stats");
    stats.appendChild(rvEl("span", "stat-chip c-cyan", "已学 " + L + "/" + concepts.length));
    stats.appendChild(rvEl("span", "stat-chip c-amber", "今日待复习 " + D));
    reviewView.appendChild(stats);

    var card = review.queue[review.idx];
    if (!card) {
      var done = rvEl("div", "review-done");
      if (review.queue.length || review.yes + review.no > 0) {
        done.appendChild(rvEl("div", "rd-icon", "🎉"));
        done.appendChild(rvEl("p", "rd-title", "本轮完成！"));
        done.appendChild(rvEl("p", "rd-sub",
          "记住 " + review.yes + " 张 · 没记住 " + review.no +
          " 张（没记住的会很快再次出现）"));
      } else {
        done.appendChild(rvEl("div", "rd-icon", "🎴"));
        done.appendChild(rvEl("p", "rd-title",
          D > 0 ? "有 " + D + " 张卡片到复习时间了" : "用闪卡主动回忆，比重复阅读记得牢"));
        done.appendChild(rvEl("p", "rd-sub",
          "正面是概念名，先在脑子里回忆要点，再翻面对答案"));
      }
      var start = rvEl("button", "rv-btn primary",
        review.queue.length || review.yes + review.no > 0 ? "再来一轮" : "开始自测");
      start.addEventListener("click", startReview);
      done.appendChild(start);
      var tip = rvEl("p", "rd-tip",
        "进度保存在本浏览器（localStorage），复习间隔 1/3/7/14/30 天逐级拉长");
      done.appendChild(tip);
      reviewView.appendChild(done);
      return;
    }

    var progRow = rvEl("div", "review-progress");
    progRow.appendChild(rvEl("span", null,
      "第 " + (review.idx + 1) + " / " + review.queue.length + " 张"));
    var bar = rvEl("div", "rv-bar");
    var fill = rvEl("div", "rv-bar-fill");
    fill.style.width = Math.round(review.idx / review.queue.length * 100) + "%";
    bar.appendChild(fill);
    progRow.appendChild(bar);
    reviewView.appendChild(progRow);

    var fc = rvEl("div", "flashcard" + (review.flipped ? " flipped" : ""));
    if (!review.flipped) {
      fc.appendChild(rvEl("span", "fc-tag", card.category));
      fc.appendChild(rvEl("div", "fc-name", card.name));
      fc.appendChild(rvEl("p", "fc-hint", "先在脑子里回忆：是什么？解决什么问题？要点有哪些？"));
      var flipBtn = rvEl("button", "rv-btn primary", "翻面看答案 (空格)");
      flipBtn.addEventListener("click", function () {
        review.flipped = true;
        renderReview();
      });
      fc.appendChild(flipBtn);
    } else {
      fc.appendChild(rvEl("span", "fc-tag", card.category + " · " + card.name));
      fc.appendChild(rvEl("p", "fc-summary", card.summary));
      fc.appendChild(rvEl("p", "fc-desc", card.description));
      var pts = rvEl("ul", "fc-points");
      card.points.forEach(function (p) {
        pts.appendChild(rvEl("li", null, p));
      });
      fc.appendChild(pts);
      var link = rvEl("button", "rv-link", "查看完整卡片 →");
      link.addEventListener("click", function () {
        switchTo("concepts", { fromRoute: true });
        openModal(card);
      });
      fc.appendChild(link);

      var grades = rvEl("div", "rv-grades");
      var noBtn = rvEl("button", "rv-btn danger", "😵 没记住 (1)");
      noBtn.addEventListener("click", function () {
        gradeCard(false);
      });
      var yesBtn = rvEl("button", "rv-btn primary", "😎 记住了 (2)");
      yesBtn.addEventListener("click", function () {
        gradeCard(true);
      });
      var skipBtn = rvEl("button", "rv-btn ghost", "跳过");
      skipBtn.addEventListener("click", function () {
        review.queue.push(review.queue[review.idx]);
        review.idx++;
        review.flipped = false;
        renderReview();
      });
      grades.appendChild(noBtn);
      grades.appendChild(yesBtn);
      grades.appendChild(skipBtn);
      fc.appendChild(grades);
    }
    reviewView.appendChild(fc);
  }

  document.addEventListener("keydown", function (e) {
    if (currentView !== "review" || reviewView.hidden) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === " " || e.key === "Enter") {
      if (!review.flipped && review.queue[review.idx]) {
        e.preventDefault();
        review.flipped = true;
        renderReview();
      }
    } else if (review.flipped && e.key === "1") {
      gradeCard(false);
    } else if (review.flipped && e.key === "2") {
      gradeCard(true);
    }
  });

  /* ==========================================================
     教程系统：实战项目 / 论文精读
     ========================================================== */
  var tutorials = [];
  var currentView = "concepts";
  var dataReady = 0;
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
      if (++dataReady === 2) applyRoute();
    })
    .catch(function () {
      tutorials = [];
      if (++dataReady === 2) applyRoute();
    });

  /* ---------- 视图切换 ---------- */
  function switchTo(view, opts) {
    currentView = view;
    document.querySelectorAll(".view-tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === view);
    });
    var isConcept = view === "concepts";
    filterBarWrap.hidden = !isConcept;
    grid.hidden = !isConcept;
    empty.hidden = true;
    tutorialList.hidden = !(view === "projects" || view === "paper");
    reviewView.hidden = view !== "review";
    if (view === "projects" || view === "paper") renderTutorialList(view);
    if (view === "review") renderReview();
    syncHash(view === "concepts" ? "" : view, opts);
  }

  document.querySelectorAll(".view-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchTo(btn.dataset.view);
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
  function openTutorial(t, opts) {
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
    openTutorialId = t.id;
    document.body.style.overflow = "hidden";
    document.querySelector(".reader").scrollTo(0, 0);
    document.getElementById("readerClose").focus();
    syncHash("tutorial=" + t.id, opts);
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

  function closeTutorial(opts) {
    readerBackdrop.hidden = true;
    openTutorialId = null;
    document.body.style.overflow = "";
    syncHash("", opts);
  }

  document.getElementById("readerClose").addEventListener("click", function () {
    closeTutorial();
  });
  readerBackdrop.addEventListener("click", function (e) {
    if (e.target === readerBackdrop) closeTutorial();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!backdrop.hidden) closeModal();
    else if (!readerBackdrop.hidden) closeTutorial();
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
