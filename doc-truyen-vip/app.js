const { stories, plans } = window.STORY_DATA;

const els = {
  view: document.querySelector("#view"),
  search: document.querySelector("#searchInput"),
  account: document.querySelector("#accountPill"),
  modal: document.querySelector("#checkoutModal"),
  checkout: document.querySelector("#checkoutContent"),
  closeCheckout: document.querySelector("#closeCheckout"),
  toastStack: document.querySelector("#toastStack"),
  menuToggle: document.querySelector("#menuToggle"),
  sidebar: document.querySelector(".sidebar")
};

const storageKey = "doctruyen_vip_state_v1";
let state = loadState();
let activeRouteHash = "";
let speechState = {
  key: "",
  chunks: [],
  index: 0,
  chunkProgress: 0,
  playing: false,
  paused: false
};
const supabaseConfig = window.SUPABASE_CONFIG || {};
const sharedCommentsEnabled = Boolean(
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  !supabaseConfig.url.includes("YOUR_") &&
  !supabaseConfig.anonKey.includes("YOUR_")
);
const remoteComments = {};

function defaultLastRead() {
  return {
    storyId: stories[0]?.id || "",
    chapterId: stories[0]?.chapters[0]?.id || ""
  };
}

function loadState() {
  const fallback = {
    user: { name: "Thanh", coins: 18, vipUntil: null },
    unlocked: {},
    transactions: [],
    comments: {},
    readerSize: 19,
    darkReader: false,
    lastRead: defaultLastRead(),
    chapterFilters: {}
  };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const merged = { ...fallback, ...saved, user: { ...fallback.user, ...(saved.user || {}) } };
    if (!getChapter(merged.lastRead?.storyId, merged.lastRead?.chapterId)) {
      merged.lastRead = defaultLastRead();
    }
    return merged;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  renderAccount();
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFC");
}

function clampReaderSize(value) {
  return Math.min(24, Math.max(16, Number(value) || 19));
}

function getSpeech() {
  return window.speechSynthesis || null;
}

function audioKey(storyId, chapterId) {
  return `${storyId}:${chapterId}`;
}

function chapterAudioUrl(chapter) {
  return chapter.audioUrl || chapter.audio || "";
}

function splitSpeechChunks(chapter) {
  const chunks = chapter.body
    .map((paragraph) => normalizeText(paragraph).trim())
    .filter(Boolean);
  const result = [];
  let current = "";

  chunks.forEach((paragraph) => {
    if ((current + "\n\n" + paragraph).length > 900 && current) {
      result.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  });

  if (current) result.push(current);
  return result;
}

function stopSpeech() {
  const speech = getSpeech();
  if (speech) speech.cancel();
  speechState = { key: "", chunks: [], index: 0, chunkProgress: 0, playing: false, paused: false };
  updateAudioStatus("Đã dừng nghe.");
  updateAudioProgress(0, "0%");
}

function preferredVoice() {
  const speech = getSpeech();
  if (!speech) return null;
  const voices = speech.getVoices();
  return (
    voices.find((voice) => voice.lang === "vi-VN" && /hoai|my|female|natural/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === "vi-VN") ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("vi")) ||
    null
  );
}

function audioPercent() {
  if (!speechState.chunks.length) return 0;
  const current = speechState.index + speechState.chunkProgress;
  return Math.min(100, Math.max(0, Math.round((current / speechState.chunks.length) * 100)));
}

function updateAudioProgress(percent = audioPercent(), label = `${percent}%`) {
  const fill = document.querySelector("[data-audio-progress]");
  const text = document.querySelector("[data-audio-progress-text]");
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = label;
}

function speakNextChunk() {
  const speech = getSpeech();
  if (!speech || !speechState.playing || speechState.paused) return;
  const text = speechState.chunks[speechState.index];
  if (!text) {
    speechState = { ...speechState, playing: false, paused: false, index: 0, chunkProgress: 0 };
    updateAudioProgress(100, "100%");
    updateAudioStatus("Đã nghe hết chương.");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = preferredVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = "vi-VN";
  utterance.rate = 0.96;
  utterance.pitch = 1;
  utterance.onstart = () => {
    speechState.chunkProgress = 0;
    updateAudioProgress();
  };
  utterance.onboundary = (event) => {
    if (!text.length || typeof event.charIndex !== "number") return;
    speechState.chunkProgress = Math.min(0.98, Math.max(0, event.charIndex / text.length));
    updateAudioProgress();
  };
  utterance.onend = () => {
    speechState.index += 1;
    speechState.chunkProgress = 0;
    updateAudioProgress();
    speakNextChunk();
  };
  utterance.onerror = () => {
    speechState.playing = false;
    updateAudioStatus("Trình duyệt không đọc được chương này.");
  };
  updateAudioStatus(`Đang nghe đoạn ${speechState.index + 1}/${speechState.chunks.length}...`);
  speech.speak(utterance);
}

function startSpeech(storyId, chapter) {
  const speech = getSpeech();
  if (!speech) {
    toast("Trình duyệt này chưa hỗ trợ đọc audio tự động.");
    return;
  }

  const key = audioKey(storyId, chapter.id);
  speech.cancel();
  speechState = {
    key,
    chunks: splitSpeechChunks(chapter),
    index: 0,
    chunkProgress: 0,
    playing: true,
    paused: false
  };
  updateAudioProgress(0, "0%");
  if (!preferredVoice()) {
    updateAudioStatus("Đang dùng giọng mặc định của trình duyệt. Nếu chưa nghe thấy, thử bấm lại sau 1 giây.");
  }
  speakNextChunk();
}

function toggleSpeechPause() {
  const speech = getSpeech();
  if (!speech || !speechState.playing) return;
  if (speechState.paused) {
    speechState.paused = false;
    speech.resume();
    updateAudioStatus("Tiếp tục nghe...");
  } else {
    speechState.paused = true;
    speech.pause();
    updateAudioStatus("Đã tạm dừng.");
  }
}

function updateAudioStatus(message) {
  const status = document.querySelector("[data-audio-status]");
  if (status) status.textContent = message;
}

function money(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value);
}

function isVip() {
  return state.user.vipUntil && new Date(state.user.vipUntil).getTime() > Date.now();
}

function getStory(storyId) {
  return stories.find((story) => story.id === storyId);
}

function getChapter(storyId, chapterId) {
  return getStory(storyId)?.chapters.find((chapter) => chapter.id === chapterId);
}

function chapterKey(storyId, chapterId) {
  return `${storyId}:${chapterId}`;
}

function canRead(storyId, chapter) {
  return chapter.free || isVip() || Boolean(state.unlocked[chapterKey(storyId, chapter.id)]);
}

function commentKey(storyId, chapterId = "story") {
  return chapterId === "story" ? `story:${storyId}` : `chapter:${storyId}:${chapterId}`;
}

function getComments(storyId, chapterId = "story") {
  const key = commentKey(storyId, chapterId);
  return sharedCommentsEnabled ? remoteComments[key] || [] : state.comments?.[key] || [];
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = supabaseConfig.url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function loadRemoteComments(storyId, chapterId = "story") {
  if (!sharedCommentsEnabled) return;
  const key = commentKey(storyId, chapterId);
  const query = `comments?target_key=eq.${encodeURIComponent(key)}&select=id,author,body,created_at&order=created_at.desc&limit=50`;
  const rows = await supabaseRequest(query);
  remoteComments[key] = rows.map((row) => ({
    id: row.id,
    author: row.author,
    text: row.body,
    createdAt: row.created_at
  }));
  refreshCommentPanel(storyId, chapterId);
}

async function addComment(storyId, chapterId, text) {
  const cleaned = text.trim();
  if (!cleaned) {
    toast("Bạn chưa nhập nội dung bình luận.");
    return false;
  }

  if (sharedCommentsEnabled) {
    const key = commentKey(storyId, chapterId);
    await supabaseRequest("comments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        target_key: key,
        story_id: storyId,
        chapter_id: chapterId === "story" ? null : chapterId,
        author: state.user.name || "Độc giả",
        body: cleaned.slice(0, 800)
      })
    });
    await loadRemoteComments(storyId, chapterId);
    toast("Đã gửi bình luận chung.");
    return true;
  }

  const key = commentKey(storyId, chapterId);
  state.comments = state.comments || {};
  state.comments[key] = [
    {
      id: crypto.randomUUID(),
      author: state.user.name || "Độc giả",
      text: cleaned.slice(0, 800),
      createdAt: new Date().toISOString()
    },
    ...(state.comments[key] || [])
  ];
  saveState();
  toast("Đã gửi bình luận.");
  return true;
}

function renderComments(storyId, chapterId = "story") {
  const comments = getComments(storyId, chapterId);
  const title = chapterId === "story" ? "Bình luận truyện" : "Bình luận chương";
  const targetKey = commentKey(storyId, chapterId);
  return `
    <section class="comments-panel" data-comments-scope="${targetKey}" data-comments-story="${storyId}" data-comments-chapter="${chapterId}">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Cộng đồng</span>
          <h2>${title}</h2>
        </div>
        <span class="status-chip">${comments.length} bình luận</span>
      </div>
      <p class="comment-mode ${sharedCommentsEnabled ? "shared" : "local"}">
        ${sharedCommentsEnabled
          ? "Bình luận chung: mọi độc giả đều thấy sau khi gửi."
          : "Chưa cấu hình Supabase nên bình luận tạm lưu trên trình duyệt này."}
      </p>
      <form class="comment-form" data-comment-form="${storyId}" data-comment-chapter="${chapterId}">
        <label>
          <span>Viết bình luận</span>
          <textarea name="comment" maxlength="800" placeholder="Chia sẻ cảm nghĩ của bạn..."></textarea>
        </label>
        <button class="btn btn-primary" type="submit">Gửi bình luận</button>
      </form>
      <div class="comment-list">
        ${comments.map((comment) => `
          <article class="comment-item">
            <div class="comment-meta">
              <strong>${comment.author}</strong>
              <span>${new Date(comment.createdAt).toLocaleString("vi-VN")}</span>
            </div>
            <p>${escapeHtml(comment.text)}</p>
          </article>
        `).join("") || `<p class="muted">Chưa có bình luận nào. Bạn mở hàng đi.</p>`}
      </div>
    </section>
  `;
}

function refreshCommentPanel(storyId, chapterId = "story") {
  const key = commentKey(storyId, chapterId);
  const panel = [...document.querySelectorAll("[data-comments-scope]")]
    .find((item) => item.dataset.commentsScope === key);
  if (panel) {
    panel.outerHTML = renderComments(storyId, chapterId);
  }
}

function hydrateVisibleComments() {
  if (!sharedCommentsEnabled) return;
  document.querySelectorAll("[data-comments-scope]").forEach((panel) => {
    loadRemoteComments(panel.dataset.commentsStory, panel.dataset.commentsChapter)
      .catch(() => {
        const mode = panel.querySelector(".comment-mode");
        if (mode) {
          mode.textContent = "Không tải được bình luận chung. Kiểm tra Supabase config/RLS.";
          mode.classList.remove("shared");
          mode.classList.add("local");
        }
      });
  });
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getEpisodeTitle(chapterTitle) {
  const match = chapterTitle.match(/^(Tập\s+\d+:\s*[^-]+)/i);
  return match ? match[1].trim() : "Chương lẻ";
}

function getStoryProgress(story) {
  const readable = story.chapters.filter((chapter) => canRead(story.id, chapter)).length;
  return Math.round((readable / story.chapters.length) * 100);
}

function unlockChapter(storyId, chapter) {
  if (canRead(storyId, chapter)) return true;
  if (state.user.coins < chapter.price) {
    toast("Không đủ xu. Nạp thêm xu hoặc mua VIP để mở chương.");
    openCheckout("coins_50");
    return false;
  }

  state.user.coins -= chapter.price;
  state.unlocked[chapterKey(storyId, chapter.id)] = true;
  state.transactions.unshift({
    id: crypto.randomUUID(),
    type: "Mở chương",
    title: `Mở khóa ${chapter.title}`,
    amount: -chapter.price,
    createdAt: new Date().toISOString()
  });
  saveState();
  toast(`Đã dùng ${chapter.price} xu để mở chương.`);
  return true;
}

function renderAccount() {
  const vipText = isVip()
    ? `VIP đến ${new Date(state.user.vipUntil).toLocaleDateString("vi-VN")}`
    : "Tài khoản thường";
  els.account.innerHTML = `
    <span class="status-chip ${isVip() ? "vip" : ""}">${vipText}</span>
    <span class="status-chip">${state.user.coins} xu</span>
    <button class="btn btn-primary" data-open-checkout="coins_50">Nạp xu</button>
  `;
}

function setActiveNav(route) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const name = link.dataset.nav;
    link.classList.toggle(
      "active",
      (route === "/" && name === "home") || route.includes(name)
    );
  });
}

function storyCard(story) {
  const lockedCount = story.chapters.filter((chapter) => !chapter.free).length;
  const progress = getStoryProgress(story);
  return `
    <article class="story-card">
      <a href="#/story/${story.id}" class="cover" style="background:${story.cover}">
        <strong>${story.title}</strong>
      </a>
      <div class="story-body">
        <div class="tags">${story.genre.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <h3>${story.title}</h3>
        <div class="story-meta">${story.author} · ${story.reads.toLocaleString("vi-VN")} lượt đọc · ${story.rating}/5</div>
        <p>${story.summary}</p>
        <div class="progress-bar" aria-label="Tiến độ mở khóa">
          <span style="width:${progress}%"></span>
        </div>
        <div class="card-footer">
          <span class="muted">${story.chapters.length} chương · ${lockedCount} chương VIP</span>
          <a class="btn btn-secondary" href="#/story/${story.id}">Xem truyện</a>
        </div>
      </div>
    </article>
  `;
}

function renderHome() {
  const lastStory = getStory(state.lastRead.storyId) || stories[0];
  const lastChapter = getChapter(lastStory.id, state.lastRead.chapterId) || lastStory.chapters[0];
  state.lastRead = { storyId: lastStory.id, chapterId: lastChapter.id };
  saveState();

  els.view.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <span class="eyebrow">Truyện phế thổ đang đăng</span>
        <h1>Phế Thổ: Ta Nhặt Được Cả Thế Giới</h1>
        <p>Thư viện đọc truyện tiếng Việt có dấu, tối ưu cho đọc dài, lưu chương đang đọc và mở khóa chương VIP bằng xu hoặc gói tháng.</p>
        <div class="hero-kpis">
          <span>${lastStory.chapters.length} chương</span>
          <span>${lastStory.reads.toLocaleString("vi-VN")} lượt đọc</span>
          <span>${lastStory.rating}/5 đánh giá</span>
        </div>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/read/${lastStory.id}/${lastChapter.id}">Đọc tiếp</a>
          <a class="btn btn-secondary" href="#/story/${lastStory.id}">Danh sách chương</a>
          <button class="btn btn-secondary" data-open-checkout="vip_30">Mua VIP 30 ngày</button>
        </div>
      </div>
      <aside class="panel quick-panel">
        <span class="eyebrow">Đang đọc</span>
        <h2>${lastChapter.title}</h2>
        <p class="muted">${lastStory.title}</p>
        <a class="reading-strip" href="#/read/${lastStory.id}/${lastChapter.id}">
          <span>Tiếp tục đọc</span>
          <strong>${lastChapter.title}</strong>
        </a>
        <div class="metrics-grid">
          <div class="metric"><span class="muted">Xu</span><strong>${state.user.coins}</strong></div>
          <div class="metric"><span class="muted">VIP</span><strong>${isVip() ? "Có" : "Chưa"}</strong></div>
          <div class="metric"><span class="muted">Đã mở</span><strong>${Object.keys(state.unlocked).length}</strong></div>
        </div>
      </aside>
    </section>

    <div class="section-head">
      <div>
        <span class="eyebrow">Thư viện</span>
        <h2>Truyện trong repo content</h2>
      </div>
      <a class="btn btn-secondary" href="#/library">Xem tất cả</a>
    </div>
    <section class="story-grid">${stories.map(storyCard).join("")}</section>

    <div class="section-head">
      <div>
        <span class="eyebrow">Gói đọc thử</span>
        <h2>Nạp xu hoặc mở VIP</h2>
      </div>
    </div>
    <section class="plans-grid">${plans.map(planCard).join("")}</section>
  `;
}

function planCard(plan) {
  return `
    <article class="payment-card">
      <span class="eyebrow">${plan.type === "vip" ? "VIP" : "Nạp xu"}</span>
      <h3>${plan.title}</h3>
      <strong>${money(plan.price)}</strong>
      <p class="muted">${plan.description}</p>
      <button class="btn btn-primary" data-open-checkout="${plan.id}">Thanh toán</button>
    </article>
  `;
}

function renderLibrary() {
  const query = els.search.value.trim().toLowerCase();
  const filtered = stories.filter((story) => {
    const haystack = `${story.title} ${story.author} ${story.genre.join(" ")} ${story.summary}`.toLowerCase();
    return haystack.includes(query);
  });

  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Thư viện</span>
        <h1>Truyện đang đăng</h1>
      </div>
      <button class="btn btn-primary" data-open-checkout="vip_30">Lên VIP</button>
    </div>
    <section class="story-grid">${filtered.map(storyCard).join("") || emptyState("Không tìm thấy truyện phù hợp.")}</section>
  `;
}

function renderStory(storyId) {
  const story = getStory(storyId);
  if (!story) return renderNotFound();

  const episodes = [...new Set(story.chapters.map((chapter) => getEpisodeTitle(chapter.title)))];
  const filter = state.chapterFilters[story.id] || { episode: "all", query: "" };
  const filteredChapters = story.chapters.filter((chapter) => {
    const episodeMatch = filter.episode === "all" || getEpisodeTitle(chapter.title) === filter.episode;
    const queryMatch = !filter.query || chapter.title.toLowerCase().includes(filter.query.toLowerCase());
    return episodeMatch && queryMatch;
  });

  els.view.innerHTML = `
    <section class="story-detail">
      <div class="detail-cover" style="background:${story.cover}">
        <div>
          <span class="eyebrow" style="color:#fff">Truyện 2K</span>
          <h1>${story.title}</h1>
        </div>
      </div>
      <div>
        <span class="eyebrow">${story.status}</span>
        <h1>${story.title}</h1>
        <p class="muted">Tác giả: ${story.author} · ${story.reads.toLocaleString("vi-VN")} lượt đọc · ${story.rating}/5</p>
        <div class="tags">${story.genre.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <p>${story.summary}</p>
        <div class="paywall-actions">
          <a class="btn btn-primary" href="#/read/${story.id}/${story.chapters[0].id}">Đọc từ đầu</a>
          <a class="btn btn-secondary" href="#/read/${state.lastRead.storyId}/${state.lastRead.chapterId}">Đọc tiếp</a>
          <button class="btn btn-secondary" data-open-checkout="vip_30">Mua VIP</button>
        </div>

        <div class="chapter-tools">
          <label>
            <span>Tập</span>
            <select data-episode-filter="${story.id}">
              <option value="all">Tất cả tập</option>
              ${episodes.map((episode) => `
                <option value="${episode}" ${filter.episode === episode ? "selected" : ""}>${episode}</option>
              `).join("")}
            </select>
          </label>
          <label>
            <span>Tìm chương</span>
            <input data-chapter-search="${story.id}" value="${filter.query}" placeholder="Nhập tên chương..." />
          </label>
        </div>

        <p class="muted">${filteredChapters.length}/${story.chapters.length} chương đang hiển thị.</p>
        <div class="chapter-list">
          ${filteredChapters.map((chapter) => chapterRow(story.id, chapter)).join("") || emptyState("Không có chương phù hợp.")}
        </div>
        ${renderComments(story.id)}
      </div>
    </section>
  `;
}

function chapterRow(storyId, chapter) {
  const locked = !canRead(storyId, chapter);
  return `
    <article class="chapter-row">
      <div>
        <strong>${chapter.title}</strong>
        <span class="muted">${chapter.free ? "Miễn phí" : locked ? `${chapter.price} xu hoặc VIP` : "Đã mở khóa"}</span>
      </div>
      <a class="btn ${locked ? "btn-secondary" : "btn-primary"}" href="#/read/${storyId}/${chapter.id}">
        ${locked ? "Mở khóa" : "Đọc"}
      </a>
    </article>
  `;
}

function renderAudioPanel(story, chapter, readable) {
  if (!readable) return "";
  const audioUrl = chapterAudioUrl(chapter);
  const nativePlayer = audioUrl
    ? `<audio controls preload="metadata" src="${escapeHtml(audioUrl)}"></audio>`
    : "";
  const modeText = audioUrl
    ? "Đang có file MP3 cho chương này. Bạn có thể nghe bằng player hoặc dùng giọng đọc trình duyệt."
    : "Chưa có file MP3 upload cho chương này, nên web dùng giọng đọc tiếng Việt của trình duyệt.";

  return `
    <section class="audio-panel" data-audio-panel="${story.id}:${chapter.id}">
      <div>
        <span class="eyebrow">Nghe truyện</span>
        <h2>Audio chương này</h2>
        <p class="muted">${modeText}</p>
      </div>
      ${nativePlayer}
      <div class="audio-progress" aria-label="Tiến trình nghe">
        <span data-audio-progress style="width:0%"></span>
      </div>
      <div class="audio-actions">
        <button class="btn btn-primary" data-speak-chapter="${story.id}:${chapter.id}">Nghe chương</button>
        <button class="btn btn-secondary" data-pause-speech>Tạm dừng / tiếp tục</button>
        <button class="btn btn-secondary" data-stop-speech>Dừng</button>
      </div>
      <p class="audio-status"><span data-audio-status>Chưa phát audio.</span> <strong data-audio-progress-text>0%</strong></p>
    </section>
  `;
}

function renderReader(storyId, chapterId) {
  const story = getStory(storyId);
  const chapter = getChapter(storyId, chapterId);
  if (!story || !chapter) return renderNotFound();

  state.readerSize = clampReaderSize(state.readerSize);
  document.documentElement.style.setProperty("--reader-size", `${state.readerSize}px`);
  document.body.classList.toggle("reader-dark", state.darkReader);

  const index = story.chapters.findIndex((item) => item.id === chapter.id);
  const prev = story.chapters[index - 1];
  const next = story.chapters[index + 1];
  const readable = canRead(storyId, chapter);

  state.lastRead = { storyId, chapterId };
  saveState();

  els.view.innerHTML = `
    <article class="reader">
      <h1>${escapeHtml(chapter.title)}</h1>
      <p class="muted reader-meta">${escapeHtml(story.title)} · ${chapter.free ? "Chương miễn phí" : `${chapter.price} xu / VIP`}</p>
      <div class="reader-toolbar">
        <a class="btn btn-secondary" href="#/story/${story.id}">Danh sách chương</a>
        <div>
          <button class="icon-btn" data-reader-size="-1" aria-label="Giảm cỡ chữ">A-</button>
          <button class="icon-btn" data-reader-size="1" aria-label="Tăng cỡ chữ">A+</button>
          <button class="btn btn-secondary" id="toggleReaderTheme">${state.darkReader ? "Nền sáng" : "Nền tối"}</button>
        </div>
      </div>
      ${
        readable
          ? `${renderAudioPanel(story, chapter, readable)}<section class="reader-content">${chapter.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</section>`
          : paywallBlock(storyId, chapter)
      }
      <div class="reader-toolbar" style="margin-top:18px; position:static">
        ${prev ? `<a class="btn btn-secondary" href="#/read/${story.id}/${prev.id}">Chương trước</a>` : "<span></span>"}
        ${next ? `<a class="btn btn-primary" href="#/read/${story.id}/${next.id}">Chương sau</a>` : "<span></span>"}
      </div>
      ${renderComments(story.id, chapter.id)}
    </article>
  `;
}

function paywallBlock(storyId, chapter) {
  return `
    <section class="paywall">
      <span class="eyebrow">Chương khóa</span>
      <h2>${chapter.title}</h2>
      <p>Chương này cần ${chapter.price} xu hoặc gói VIP 30 ngày. Bạn đang có ${state.user.coins} xu.</p>
      <div class="paywall-actions">
        <button class="btn btn-primary" data-unlock-chapter="${storyId}:${chapter.id}">Mở bằng ${chapter.price} xu</button>
        <button class="btn btn-secondary" data-open-checkout="vip_30">Mua VIP</button>
        <button class="btn btn-secondary" data-open-checkout="coins_50">Nạp xu</button>
      </div>
    </section>
  `;
}

function renderWallet() {
  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Ví độc giả</span>
        <h1>Nạp xu và VIP</h1>
      </div>
      <span class="status-chip ${isVip() ? "vip" : ""}">${isVip() ? "Đang VIP" : "Tài khoản thường"}</span>
    </div>
    <section class="plans-grid">${plans.map(planCard).join("")}</section>
    <div class="section-head"><h2>Lịch sử giao dịch</h2></div>
    ${transactionTable()}
  `;
}

function transactionTable() {
  if (!state.transactions.length) return emptyState("Chưa có giao dịch nào.");
  return `
    <table class="admin-table">
      <thead><tr><th>Thời gian</th><th>Nội dung</th><th>Loại</th><th>Giá trị</th></tr></thead>
      <tbody>
        ${state.transactions.map((tx) => `
          <tr>
            <td>${new Date(tx.createdAt).toLocaleString("vi-VN")}</td>
            <td>${tx.title}</td>
            <td>${tx.type}</td>
            <td>${tx.amount > 0 ? money(tx.amount) : `${tx.amount} xu`}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAdmin() {
  const totalLocked = stories.flatMap((story) => story.chapters).filter((chapter) => !chapter.free).length;
  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Quản trị</span>
        <h1>Vận hành nội dung</h1>
      </div>
      <button class="btn btn-danger" id="resetDemo">Làm mới dữ liệu thử</button>
    </div>
    <section class="metrics-grid">
      <div class="metric"><span class="muted">Tổng truyện</span><strong>${stories.length}</strong></div>
      <div class="metric"><span class="muted">Chương khóa</span><strong>${totalLocked}</strong></div>
      <div class="metric"><span class="muted">Giao dịch</span><strong>${state.transactions.length}</strong></div>
    </section>
    <div class="section-head"><h2>Bảng truyện</h2></div>
    <table class="admin-table">
      <thead><tr><th>Truyện</th><th>Tác giả</th><th>Chương</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
      <tbody>
        ${stories.map((story) => `
          <tr>
            <td>${story.title}</td>
            <td>${story.author}</td>
            <td>${story.chapters.length}</td>
            <td>${story.status}</td>
            <td>${story.updatedAt}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function openCheckout(planId) {
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return;
  const orderCode = `DTV${Date.now().toString().slice(-8)}`;
  els.checkout.innerHTML = `
    <span class="eyebrow">VietQR / payOS</span>
    <h2 id="checkoutTitle">${plan.title}</h2>
    <p class="muted">${plan.description}</p>
    <div class="qr-box" aria-label="Mã QR thanh toán"><span>${orderCode}</span></div>
    <p><strong>Số tiền:</strong> ${money(plan.price)}</p>
    <p><strong>Nội dung:</strong> ${orderCode} ${plan.id}</p>
    <p class="muted">Cổng thanh toán đang ở chế độ thử nghiệm. Khi nối payOS thật, hệ thống sẽ tự kích hoạt gói sau khi ngân hàng xác nhận.</p>
    <div class="paywall-actions">
      <button class="btn btn-primary" data-confirm-payment="${plan.id}">Xác nhận thanh toán thử</button>
      <button class="btn btn-secondary" id="copyOrderCode">Copy mã đơn</button>
    </div>
  `;
  els.modal.hidden = false;
}

function confirmPayment(planId) {
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return;
  if (plan.type === "vip") {
    const base = isVip() ? new Date(state.user.vipUntil) : new Date();
    base.setDate(base.getDate() + plan.days);
    state.user.vipUntil = base.toISOString();
  } else {
    state.user.coins += plan.coins;
  }
  state.transactions.unshift({
    id: crypto.randomUUID(),
    type: plan.type === "vip" ? "VIP" : "Nạp xu",
    title: plan.title,
    amount: plan.price,
    createdAt: new Date().toISOString()
  });
  saveState();
  els.modal.hidden = true;
  toast(`Đã kích hoạt ${plan.title}.`);
  route();
}

function emptyState(text) {
  return `<div class="panel"><p class="muted">${text}</p></div>`;
}

function renderNotFound() {
  els.view.innerHTML = emptyState("Không tìm thấy trang này.");
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  els.toastStack.append(item);
  setTimeout(() => item.remove(), 3200);
}

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const shouldScrollTop = hash !== activeRouteHash;
  if (shouldScrollTop) stopSpeech();
  activeRouteHash = hash;
  const [_, routeName, id, chapterId] = hash.split("/");
  document.body.classList.toggle("reader-dark", state.darkReader && routeName === "read");
  setActiveNav(hash);
  if (hash === "/") renderHome();
  else if (routeName === "library") renderLibrary();
  else if (routeName === "story") renderStory(id);
  else if (routeName === "read") renderReader(id, chapterId);
  else if (routeName === "wallet") renderWallet();
  else if (routeName === "admin") renderAdmin();
  else renderNotFound();
  hydrateVisibleComments();
  els.view.focus({ preventScroll: true });
  if (shouldScrollTop) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

document.addEventListener("click", (event) => {
  const checkoutButton = event.target.closest("[data-open-checkout]");
  if (checkoutButton) openCheckout(checkoutButton.dataset.openCheckout);

  const confirmButton = event.target.closest("[data-confirm-payment]");
  if (confirmButton) confirmPayment(confirmButton.dataset.confirmPayment);

  const unlockButton = event.target.closest("[data-unlock-chapter]");
  if (unlockButton) {
    const [storyId, chapterId] = unlockButton.dataset.unlockChapter.split(":");
    const chapter = getChapter(storyId, chapterId);
    if (chapter && unlockChapter(storyId, chapter)) route();
  }

  const sizeButton = event.target.closest("[data-reader-size]");
  if (sizeButton) {
    state.readerSize = clampReaderSize(state.readerSize + Number(sizeButton.dataset.readerSize));
    saveState();
    route();
  }

  const speakButton = event.target.closest("[data-speak-chapter]");
  if (speakButton) {
    const [storyId, chapterId] = speakButton.dataset.speakChapter.split(":");
    const chapter = getChapter(storyId, chapterId);
    if (chapter) startSpeech(storyId, chapter);
  }

  if (event.target.closest("[data-pause-speech]")) {
    toggleSpeechPause();
  }

  if (event.target.closest("[data-stop-speech]")) {
    stopSpeech();
  }

  if (event.target.id === "toggleReaderTheme") {
    state.darkReader = !state.darkReader;
    saveState();
    route();
  }

  if (event.target.id === "resetDemo") {
    localStorage.removeItem(storageKey);
    state = loadState();
    toast("Đã làm mới dữ liệu thử.");
    route();
  }

  if (event.target.id === "copyOrderCode") {
    const text = els.checkout.querySelector(".qr-box span")?.textContent || "";
    navigator.clipboard?.writeText(text);
    toast("Đã copy mã đơn.");
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");
  if (!form) return;
  event.preventDefault();
  const storyId = form.dataset.commentForm;
  const chapterId = form.dataset.commentChapter || "story";
  const input = form.elements.comment;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Đang gửi...";
  try {
    if (await addComment(storyId, chapterId, input.value)) {
      input.value = "";
      if (!sharedCommentsEnabled) {
        if (chapterId === "story") renderStory(storyId);
        else route();
      }
    }
  } catch {
    toast("Chưa gửi được bình luận chung. Kiểm tra Supabase config.");
  } finally {
    button.disabled = false;
    button.textContent = "Gửi bình luận";
  }
});

document.addEventListener("change", (event) => {
  const episodeSelect = event.target.closest("[data-episode-filter]");
  if (!episodeSelect) return;
  const storyId = episodeSelect.dataset.episodeFilter;
  state.chapterFilters[storyId] = {
    ...(state.chapterFilters[storyId] || { query: "" }),
    episode: episodeSelect.value
  };
  saveState();
  renderStory(storyId);
});

document.addEventListener("input", (event) => {
  const chapterSearch = event.target.closest("[data-chapter-search]");
  if (!chapterSearch) return;
  const storyId = chapterSearch.dataset.chapterSearch;
  state.chapterFilters[storyId] = {
    ...(state.chapterFilters[storyId] || { episode: "all" }),
    query: chapterSearch.value
  };
  const cursor = chapterSearch.selectionStart || chapterSearch.value.length;
  saveState();
  renderStory(storyId);
  const nextInput = document.querySelector(`[data-chapter-search="${storyId}"]`);
  if (nextInput) {
    nextInput.focus();
    nextInput.setSelectionRange(cursor, cursor);
  }
});

els.closeCheckout.addEventListener("click", () => {
  els.modal.hidden = true;
});

els.modal.addEventListener("click", (event) => {
  if (event.target === els.modal) els.modal.hidden = true;
});

els.search.addEventListener("input", () => {
  if ((location.hash || "#/") !== "#/library") location.hash = "#/library";
  else renderLibrary();
});

els.menuToggle.addEventListener("click", () => {
  els.sidebar.classList.toggle("open");
});

window.addEventListener("hashchange", () => {
  els.sidebar.classList.remove("open");
  route();
});

getSpeech()?.addEventListener?.("voiceschanged", () => {
  if (!speechState.playing) return;
  updateAudioStatus("Đã sẵn sàng giọng đọc tiếng Việt.");
});

renderAccount();
route();
