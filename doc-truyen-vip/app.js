const initialStoryData = window.STORY_DATA || { stories: [], plans: [] };
let stories = initialStoryData.stories || [];
const STORY_THUMBNAILS = {
  "phe-tho-ta-nhat-duoc-ca-the-gioi": "assets/phe-tho-ta-nhat-duoc-ca-the-gioi-thumb.webp"
};

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
const audioVoicePresets = [
  {
    id: "nu-cam-xuc",
    label: "Hoài My - nữ Việt",
    voiceMatch: /hoai|my|female|woman|natural/i,
    fallbackRate: 1,
    fallbackPitch: 1.08
  },
  {
    id: "nam-tram",
    label: "Nam Minh - nam Việt",
    voiceMatch: /nam|minh|male|man|natural/i,
    fallbackRate: 0.92,
    fallbackPitch: 0.78
  }
];
const audioSpeedOptions = [0.75, 0.9, 1, 1.15, 1.3, 1.5];
const preferGeneratedMp3 = true;
const EMAIL_OTP_EXPIRES_IN_MS = 20 * 60 * 1000;
let state = loadState();
let activeRouteHash = "";
let audioManifestLoaded = false;
let audioManifestFailed = false;
const audioManifestUrls = new Map();
let speechState = {
  key: "",
  chunks: [],
  index: 0,
  chunkProgress: 0,
  playing: false,
  paused: false
};
let isAudioSeeking = false;
let audioWasPlayingBeforeSeek = false;
let audioProgressFrame = 0;
let storyCatalogReady = false;
let storyCatalogError = "";
const authorizedChapterCache = new Map();
const supabaseConfig = window.SUPABASE_CONFIG || {};
const sharedCommentsEnabled = Boolean(
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  !supabaseConfig.url.includes("YOUR_") &&
  !supabaseConfig.anonKey.includes("YOUR_")
);
const supabaseClient = sharedCommentsEnabled && window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;
const remoteComments = {};
let authSession = null;
let authUser = null;
let userVipUntil = null;
let pendingEmailOtp = null;
let isAdminUser = false;
let adminState = {
  loading: false,
  error: "",
  stories: [],
  chapters: [],
  chapterBody: [],
  comments: [],
  profiles: [],
  wallets: [],
  vip: [],
  transactions: []
};
let accountSummary = {
  wallet: { balance_vnd: 0, coin_balance: 0 },
  progress: [],
  unlocked: [],
  vip: [],
  transactions: []
};

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
    audioVoice: "nu-cam-xuc",
    audioSpeed: 1,
    commenterName: "",
    lastRead: defaultLastRead(),
    chapterFilters: {},
    admin: { storyId: "", chapterId: "" }
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

function accountDisplayName() {
  return (
    authUser?.user_metadata?.display_name ||
    authUser?.user_metadata?.name ||
    authUser?.email?.split("@")[0] ||
    state.commenterName ||
    "Độc giả"
  );
}

function accountEmail() {
  return authUser?.email || "";
}

function isLoggedIn() {
  return Boolean(authUser?.id);
}

function hasAccountVip() {
  return userVipUntil && new Date(userVipUntil).getTime() > Date.now();
}

function vipDaysLeft() {
  if (!hasAccountVip()) return 0;
  return Math.max(0, Math.ceil((new Date(userVipUntil).getTime() - Date.now()) / 86400000));
}

function currentAccountProgress() {
  const remote = accountSummary.progress?.[0];
  if (remote && getChapter(remote.story_id, remote.chapter_id)) {
    return remote;
  }
  return state.lastRead;
}

async function loadVipEntitlement() {
  userVipUntil = null;
  if (!supabaseClient || !authUser) return;
  const { data, error } = await supabaseClient
    .from("vip_entitlements")
    .select("active_until")
    .eq("user_id", authUser.id)
    .gt("active_until", new Date().toISOString())
    .order("active_until", { ascending: false })
    .limit(1);
  if (!error && data?.[0]?.active_until) userVipUntil = data[0].active_until;
}

function resetAccountSummary() {
  accountSummary = {
    wallet: { balance_vnd: 0, coin_balance: 0 },
    progress: [],
    unlocked: [],
    vip: [],
    transactions: []
  };
}

async function loadAccountSummary() {
  resetAccountSummary();
  if (!supabaseClient || !authUser) return;

  const [walletRes, progressRes, unlockedRes, vipRes, txRes] = await Promise.all([
    supabaseClient.from("account_wallets").select("balance_vnd,coin_balance").eq("user_id", authUser.id).maybeSingle(),
    supabaseClient.from("reading_progress").select("story_id,chapter_id,updated_at").eq("user_id", authUser.id).order("updated_at", { ascending: false }),
    supabaseClient.from("unlocked_chapters").select("story_id,chapter_id,source,created_at").eq("user_id", authUser.id).order("created_at", { ascending: false }),
    supabaseClient.from("vip_entitlements").select("plan_id,active_until,source,created_at").eq("user_id", authUser.id).order("active_until", { ascending: false }),
    supabaseClient.from("coin_transactions").select("amount,reason,story_id,chapter_id,created_at").eq("user_id", authUser.id).order("created_at", { ascending: false }).limit(20)
  ]);

  if (!walletRes.error && walletRes.data) accountSummary.wallet = walletRes.data;
  if (!progressRes.error && progressRes.data) accountSummary.progress = progressRes.data;
  if (!unlockedRes.error && unlockedRes.data) accountSummary.unlocked = unlockedRes.data;
  if (!vipRes.error && vipRes.data) accountSummary.vip = vipRes.data;
  if (!txRes.error && txRes.data) accountSummary.transactions = txRes.data;
}

async function loadAdminStatus() {
  isAdminUser = false;
  if (!supabaseClient || !authUser) return false;
  const { data, error } = await supabaseClient.rpc("is_admin");
  if (!error) isAdminUser = data === true;
  return isAdminUser;
}

function resetAdminState() {
  adminState = {
    loading: false,
    error: "",
    stories: [],
    chapters: [],
    chapterBody: [],
    comments: [],
    profiles: [],
    wallets: [],
    vip: [],
    transactions: []
  };
}

async function loadAdminData() {
  resetAdminState();
  if (!supabaseClient || !authUser || !isAdminUser) return;
  adminState.loading = true;

  const selectedStoryId = state.admin?.storyId || stories[0]?.id || "";
  const selectedChapterId = state.admin?.chapterId || "";
  const [
    storyRes,
    chapterRes,
    bodyRes,
    commentRes,
    profileRes,
    walletRes,
    vipRes,
    txRes
  ] = await Promise.all([
    supabaseClient.from("stories").select("*").order("sort_order", { ascending: true }),
    selectedStoryId
      ? supabaseClient.from("story_chapters").select("*").eq("story_id", selectedStoryId).order("sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    selectedStoryId && selectedChapterId
      ? supabaseClient.from("story_chapter_bodies").select("body").eq("story_id", selectedStoryId).eq("chapter_id", selectedChapterId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseClient.from("comments").select("id,target_key,story_id,chapter_id,author,body,user_email,is_hidden,created_at").order("created_at", { ascending: false }).limit(60),
    supabaseClient.from("profiles").select("id,email,display_name,updated_at").order("updated_at", { ascending: false }).limit(80),
    supabaseClient.from("account_wallets").select("user_id,balance_vnd,coin_balance,updated_at"),
    supabaseClient.from("vip_entitlements").select("user_id,plan_id,active_until,source,created_at").order("active_until", { ascending: false }),
    supabaseClient.from("coin_transactions").select("user_id,amount,reason,story_id,chapter_id,created_at").order("created_at", { ascending: false }).limit(80)
  ]);

  adminState.loading = false;
  const firstError = [storyRes, chapterRes, bodyRes, commentRes, profileRes, walletRes, vipRes, txRes].find((item) => item.error)?.error;
  if (firstError) {
    adminState.error = firstError.message || "Không tải được dữ liệu admin.";
    return;
  }

  adminState.stories = storyRes.data || [];
  adminState.chapters = chapterRes.data || [];
  adminState.chapterBody = Array.isArray(bodyRes.data?.body) ? bodyRes.data.body : [];
  adminState.comments = commentRes.data || [];
  adminState.profiles = profileRes.data || [];
  adminState.wallets = walletRes.data || [];
  adminState.vip = vipRes.data || [];
  adminState.transactions = txRes.data || [];

  const resolvedChapterId = selectedChapterId || adminState.chapters[0]?.chapter_id || "";
  state.admin = { storyId: selectedStoryId, chapterId: resolvedChapterId };
  if (selectedStoryId && resolvedChapterId && !selectedChapterId) {
    const { data: resolvedBody, error: resolvedBodyError } = await supabaseClient
      .from("story_chapter_bodies")
      .select("body")
      .eq("story_id", selectedStoryId)
      .eq("chapter_id", resolvedChapterId)
      .maybeSingle();
    if (resolvedBodyError) adminState.error = resolvedBodyError.message || "Không tải được nội dung chương.";
    else adminState.chapterBody = Array.isArray(resolvedBody?.body) ? resolvedBody.body : [];
  }
}

async function upsertProfile() {
  if (!supabaseClient || !authUser) return;
  await supabaseClient
    .from("profiles")
    .upsert({
      id: authUser.id,
      email: accountEmail(),
      display_name: accountDisplayName(),
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
}

async function saveReadingProgress(storyId, chapterId) {
  if (!supabaseClient || !authUser) return;
  await supabaseClient
    .from("reading_progress")
    .upsert({
      user_id: authUser.id,
      story_id: storyId,
      chapter_id: chapterId,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,story_id" });
  await loadAccountSummary();
  renderAccount();
}

async function initAuth() {
  if (!supabaseClient) {
    renderAccount();
    return;
  }
  const hadAuthRedirect = isAuthRedirectHash();
  handleAuthRedirectNotice();
  if (hadAuthRedirect) await exchangeAuthCodeFromRedirect();
  const { data } = await supabaseClient.auth.getSession();
  authSession = data?.session || null;
  authUser = authSession?.user || null;
  if (authUser) {
    pendingEmailOtp = null;
    els.modal.hidden = true;
    state.commenterName = accountDisplayName();
    saveState();
    await upsertProfile();
    finishAuthRedirect(hadAuthRedirect);
  }
  await loadVipEntitlement();
  await loadAccountSummary();
  await loadAdminStatus();
  renderAccount();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    authSession = session || null;
    authUser = authSession?.user || null;
    if (authUser) {
      pendingEmailOtp = null;
      els.modal.hidden = true;
      state.commenterName = accountDisplayName();
      saveState();
      await upsertProfile();
      finishAuthRedirect(isAuthRedirectHash());
    }
    await loadVipEntitlement();
    await loadAccountSummary();
    await loadAdminStatus();
    renderAccount();
    hydrateVisibleComments();
  });
}

function authRedirectParams(hashValue = location.hash, searchValue = location.search) {
  const params = new URLSearchParams(normalizeText(searchValue).replace(/^\?/, ""));
  const hash = normalizeText(hashValue).replace(/^#/, "");
  if (hash && !hash.startsWith("/")) {
    const hashParams = new URLSearchParams(hash);
    hashParams.forEach((value, key) => params.set(key, value));
    if (/^[A-Za-z0-9_-]{20,}$/.test(hash) && !params.has("token_hash")) {
      params.set("token_hash", hash);
    }
  }
  return params;
}

function isAuthRedirectHash(hashValue = location.hash, searchValue = location.search) {
  const hash = normalizeText(hashValue).replace(/^#/, "");
  const params = authRedirectParams(hashValue, searchValue);
  return (
    params.has("access_token") ||
    params.has("refresh_token") ||
    params.has("token_hash") ||
    params.has("type") ||
    params.has("code") ||
    params.has("error") ||
    params.has("error_code") ||
    (hash && !hash.startsWith("/") && params.has("token_hash"))
  );
}

function finishAuthRedirect(shouldRedirect) {
  if (!shouldRedirect) return;
  toast("Xác nhận email thành công. Tài khoản đã đăng nhập.");
  history.replaceState(null, "", `${location.pathname}#/account`);
}

function handleAuthRedirectNotice() {
  const params = authRedirectParams();
  const errorCode = params.get("error_code");
  if (!errorCode) return;
  toast(errorCode === "otp_expired"
    ? "Link xác nhận đã hết hạn. Bấm gửi lại email xác nhận."
    : "Không xác nhận được email. Thử gửi lại link xác nhận.");
  history.replaceState(null, "", `${location.pathname}#/`);
}

async function exchangeAuthCodeFromRedirect() {
  if (!supabaseClient) return false;
  const params = authRedirectParams();
  const code = params.get("code");
  if (!code) return false;

  const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
  if (error) {
    toast("Link xác nhận không hợp lệ hoặc đã hết hạn. Bấm gửi lại email xác nhận.");
    history.replaceState(null, "", `${location.pathname}#/`);
    return false;
  }
  return true;
}

function normalizeCatalogStory(story) {
  const thumbnail = STORY_THUMBNAILS[story.id];
  return {
    ...story,
    cover: thumbnail || story.cover,
    genre: Array.isArray(story.genre) ? story.genre : [],
    reads: Number(story.reads || 0),
    rating: Number(story.rating || 0),
    chapters: Array.isArray(story.chapters) ? story.chapters.map((chapter) => ({
      ...chapter,
      free: chapter.free !== false,
      price: Number(chapter.price || chapter.price_coins || 0),
      audioUrls: chapter.audioUrls || chapter.audio_urls || {}
    })) : []
  };
}

function hydrateLastReadFromCatalog() {
  if (!stories.length) return;
  if (!getChapter(state.lastRead?.storyId, state.lastRead?.chapterId)) {
    state.lastRead = defaultLastRead();
    saveState();
  }
}

async function loadStoryCatalog() {
  storyCatalogError = "";
  if (!supabaseClient) {
    storyCatalogError = "Chưa kết nối database truyện.";
    storyCatalogReady = true;
    return;
  }

  const { data, error } = await supabaseClient.rpc("get_story_catalog");
  if (error) {
    storyCatalogError = "Không tải được danh sách truyện từ database.";
    stories = [];
    storyCatalogReady = true;
    return;
  }

  const payload = data || {};
  stories = (payload.stories || []).map(normalizeCatalogStory);
  hydrateLastReadFromCatalog();
  storyCatalogReady = true;
}

async function loadChapterForReader(storyId, chapterId) {
  const key = chapterKey(storyId, chapterId);
  if (authorizedChapterCache.has(key)) return authorizedChapterCache.get(key);
  if (!supabaseClient) throw new Error("DATABASE_REQUIRED");

  const { data, error } = await supabaseClient.rpc("get_chapter_for_reader", {
    p_story_id: storyId,
    p_chapter_id: chapterId
  });
  if (error) throw error;

  const chapter = {
    ...data,
    id: data.id || chapterId,
    free: data.free !== false,
    price: Number(data.price || 0),
    body: Array.isArray(data.body) ? data.body : [],
    audioUrls: data.audioUrls || data.audio_urls || {}
  };
  if (chapter.can_read) authorizedChapterCache.set(key, chapter);
  return chapter;
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

function selectedAudioVoice() {
  return audioVoicePresets.some((voice) => voice.id === state.audioVoice)
    ? state.audioVoice
    : audioVoicePresets[0].id;
}

function selectedAudioVoiceProfile() {
  return audioVoicePresets.find((voice) => voice.id === selectedAudioVoice()) || audioVoicePresets[0];
}

function selectedAudioSpeed() {
  return audioSpeedOptions.includes(Number(state.audioSpeed)) ? Number(state.audioSpeed) : 1;
}

function audioKey(storyId, chapterId) {
  return `${storyId}:${chapterId}`;
}

function chapterAudioUrl(chapter, voiceId = selectedAudioVoice()) {
  if (!preferGeneratedMp3) return "";
  const manifestUrl = audioManifestUrls.get(`${chapter.id}:${voiceId}`);
  if (manifestUrl) return manifestUrl;
  if (audioManifestLoaded) return "";
  const urls = chapter.audioUrls || {};
  return urls[voiceId] || (voiceId === "nu-cam-xuc" ? chapter.audioUrl || chapter.audio || "" : "");
}

async function loadAudioManifest() {
  if (!preferGeneratedMp3) return;
  try {
    const response = await fetch(`audio/verified-audio.json?v=20260630-audio-manifest`, { cache: "no-store" });
    if (!response.ok) throw new Error(`audio manifest ${response.status}`);
    const payload = await response.json();
    (payload.files || []).forEach((item) => {
      if (!item.verified || item.provider !== "edge" || !item.chapterId || !item.preset || !item.file) return;
      audioManifestUrls.set(`${item.chapterId}:${item.preset}`, `audio/${item.file}`);
    });
    audioManifestLoaded = true;
  } catch {
    audioManifestFailed = true;
  }
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

function preferredVoice(profile = selectedAudioVoiceProfile()) {
  const speech = getSpeech();
  if (!speech) return null;
  const voices = speech.getVoices();
  return (
    voices.find((voice) => voice.lang === "vi-VN" && profile.voiceMatch.test(voice.name)) ||
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
  const seek = document.querySelector("[data-audio-seek]");
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = label;
  if (seek && !isAudioSeeking && document.activeElement !== seek) seek.value = String(percent);
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function seekSpeechPercent(percent) {
  if (!speechState.chunks.length) {
    updateAudioProgress(percent, `${percent}%`);
    return;
  }
  const speech = getSpeech();
  const target = Math.min(
    speechState.chunks.length - 1,
    Math.max(0, Math.floor((percent / 100) * speechState.chunks.length))
  );
  speechState.index = target;
  speechState.chunkProgress = 0;
  updateAudioProgress(audioPercent());
  updateAudioStatus(`Đã tua tới đoạn ${target + 1}/${speechState.chunks.length}.`);
  if (speechState.playing && !speechState.paused && speech) {
    speech.cancel();
    setTimeout(speakNextChunk, 80);
  }
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
  const profile = selectedAudioVoiceProfile();
  const voice = preferredVoice(profile);
  if (voice) utterance.voice = voice;
  utterance.lang = "vi-VN";
  utterance.rate = Math.min(1.5, Math.max(0.75, selectedAudioSpeed() * profile.fallbackRate));
  utterance.pitch = Math.min(2, Math.max(0.5, profile.fallbackPitch));
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

function applyGeneratedAudioSpeed() {
  document.querySelectorAll("[data-generated-audio]").forEach((audio) => {
    audio.playbackRate = selectedAudioSpeed();
  });
}

function currentGeneratedAudio() {
  return document.querySelector("[data-generated-audio]");
}

function updateGeneratedAudioProgress(audio) {
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const percent = Math.min(100, Math.max(0, (audio.currentTime / audio.duration) * 100));
  updateAudioProgress(percent, `${Math.round(percent)}%`);
  updateAudioStatus(`Đang ở ${formatAudioTime(audio.currentTime)} / ${formatAudioTime(audio.duration)}.`);
}

function startAudioProgressLoop(audio) {
  cancelAnimationFrame(audioProgressFrame);
  const tick = () => {
    if (!isAudioSeeking) updateGeneratedAudioProgress(audio);
    if (!audio.paused && !audio.ended) {
      audioProgressFrame = requestAnimationFrame(tick);
    }
  };
  audioProgressFrame = requestAnimationFrame(tick);
}

function seekGeneratedAudioToPercent(percent, resumeAfterSeek = true) {
  const audio = currentGeneratedAudio();
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  const target = Math.min(audio.duration, Math.max(0, (percent / 100) * audio.duration));
  audio.currentTime = target;
  updateGeneratedAudioProgress(audio);
  updateAudioStatus(`Đã tua tới ${formatAudioTime(target)} / ${formatAudioTime(audio.duration)}.`);
  if (resumeAfterSeek && audioWasPlayingBeforeSeek) {
    audio.play()
      .then(() => startAudioProgressLoop(audio))
      .catch(() => updateAudioStatus("Đã tua xong. Bấm play để phát tiếp."));
  }
  return true;
}

async function playAudioForChapter(storyId, chapter) {
  const audio = currentGeneratedAudio();
  if (audio) {
    stopSpeech();
    audio.playbackRate = selectedAudioSpeed();
    audio.play()
      .then(() => {
        updateAudioStatus(`Đang phát MP3 Edge ở tốc độ ${selectedAudioSpeed()}x.`);
        startAudioProgressLoop(audio);
      })
      .catch(() => {
        updateAudioStatus("Trình duyệt chặn autoplay. Bấm trực tiếp nút play trên player MP3.");
      });
    return;
  }
  try {
    const dbChapter = await loadChapterForReader(storyId, chapter.id);
    if (!dbChapter.can_read) {
      toast("Mở khóa chương trước rồi mới nghe được.");
      return;
    }
    startSpeech(storyId, { ...chapter, ...dbChapter });
  } catch {
    toast("Không tải được nội dung audio từ database.");
  }
}

function money(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value);
}

function isVip() {
  return hasAccountVip() || (state.user.vipUntil && new Date(state.user.vipUntil).getTime() > Date.now());
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
  if (!chapter) return false;
  if (chapter.free !== false) return true;
  if (isVip()) return true;
  return isChapterUnlocked(storyId, chapter.id);
}

function chapterPriceCoins(chapter) {
  return Math.max(0, Number(chapter?.price || chapter?.price_coins || 0));
}

function isChapterUnlocked(storyId, chapterId) {
  return accountSummary.unlocked.some((item) => item.story_id === storyId && item.chapter_id === chapterId);
}

function commentKey(storyId, chapterId = "story") {
  return chapterId === "story" ? `story:${storyId}` : `chapter:${storyId}:${chapterId}`;
}

function getComments(storyId, chapterId = "story") {
  const key = commentKey(storyId, chapterId);
  return sharedCommentsEnabled ? remoteComments[key] || [] : state.comments?.[key] || [];
}

function cleanCommentAuthor(value) {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "Độc giả";
}

function cleanCommentBody(value) {
  return normalizeText(value)
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 800);
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = supabaseConfig.url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${authSession?.access_token || supabaseConfig.anonKey}`,
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
  const query = `comments?target_key=eq.${encodeURIComponent(key)}&is_hidden=eq.false&select=id,author,body,created_at&order=created_at.desc&limit=50`;
  const rows = await supabaseRequest(query);
  remoteComments[key] = rows.map((row) => ({
    id: row.id,
    author: row.author,
    text: row.body,
    createdAt: row.created_at
  }));
  refreshCommentPanel(storyId, chapterId);
}

async function addComment(storyId, chapterId, author, text) {
  const cleaned = cleanCommentBody(text);
  const cleanedAuthor = cleanCommentAuthor(author);
  if (!cleaned) {
    toast("Bạn chưa nhập nội dung bình luận.");
    return false;
  }
  if (cleaned.length < 2) {
    toast("Bình luận ngắn quá, viết thêm chút nữa nha.");
    return false;
  }

  state.commenterName = cleanedAuthor;
  saveState();

  if (sharedCommentsEnabled) {
    if (!isLoggedIn()) {
      openAuthModal();
      toast("Đăng nhập trước rồi gửi bình luận chung nha.");
      return false;
    }
    const key = commentKey(storyId, chapterId);
    await supabaseRequest("comments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        target_key: key,
        story_id: storyId,
        chapter_id: chapterId === "story" ? null : chapterId,
        user_id: authUser?.id || null,
        user_email: accountEmail() || null,
        author: cleanedAuthor,
        body: cleaned
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
      author: cleanedAuthor,
      text: cleaned,
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
  const commenterName = escapeHtml(state.commenterName || "");
  const commentForm = sharedCommentsEnabled && !isLoggedIn()
    ? `
      <div class="comment-login">
        <p class="muted">Đăng nhập để gửi bình luận chung. Mọi người vẫn đọc được bình luận đã duyệt.</p>
        <button class="btn btn-primary" type="button" data-open-auth>Đăng nhập</button>
      </div>
    `
    : `
      <form class="comment-form" data-comment-form="${storyId}" data-comment-chapter="${chapterId}">
        <div class="comment-fields">
          <label>
            <span>Tên hiển thị</span>
            <input name="author" maxlength="40" value="${commenterName}" placeholder="Tên của bạn" autocomplete="nickname" />
          </label>
          <label>
            <span>Viết bình luận</span>
            <textarea name="comment" maxlength="800" placeholder="Chia sẻ cảm nghĩ của bạn..."></textarea>
          </label>
        </div>
        <input class="comment-honeypot" name="website" autocomplete="off" tabindex="-1" aria-hidden="true" />
        <button class="btn btn-primary" type="submit">Gửi bình luận</button>
      </form>
    `;
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
          ? "Bình luận chung: đăng nhập để gửi, mọi độc giả đều thấy sau khi duyệt."
          : "Chưa cấu hình Supabase nên bình luận tạm lưu trên trình duyệt này."}
      </p>
      ${commentForm}
      <div class="comment-list">
        ${comments.map((comment) => `
          <article class="comment-item">
            <div class="comment-meta">
              <strong>${escapeHtml(comment.author)}</strong>
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

function cssString(value) {
  return normalizeText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "");
}

function isImageCover(value) {
  return /^(https?:\/\/|\.?\.?\/|assets\/).+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(normalizeText(value).trim());
}

function coverStyle(cover, overlay = "card") {
  const value = normalizeText(cover).trim();
  if (!value) return "background:linear-gradient(145deg, #d9f99d, #16a34a 45%, #111827)";
  if (!isImageCover(value)) return `background:${escapeHtml(value)}`;
  const shade = overlay === "hero"
    ? "linear-gradient(90deg, rgba(9, 13, 24, 0.92), rgba(9, 13, 24, 0.70) 48%, rgba(9, 13, 24, 0.18))"
    : overlay === "detail"
    ? "linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.62))"
    : "linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.68))";
  return `background-image:${shade},url('${cssString(value)}');background-size:cover;background-position:center`;
}

function getEpisodeTitle(chapterTitle) {
  const match = chapterTitle.match(/^(Tập\s+\d+:\s*[^-]+)/i);
  return match ? match[1].trim() : "Chương lẻ";
}

function getStoryProgress(story) {
  const readable = story.chapters.filter((chapter) => canRead(story.id, chapter)).length;
  return Math.round((readable / story.chapters.length) * 100);
}

async function unlockChapter(storyId, chapter) {
  if (canRead(storyId, chapter)) return true;
  if (!supabaseClient) {
    toast("Chưa kết nối tài khoản, tạm thời chưa mở khóa chương tính phí được.");
    return false;
  }
  if (!isLoggedIn()) {
    openAuthModal();
    toast("Đăng nhập trước rồi mở khóa chương nha.");
    return false;
  }

  const { data, error } = await supabaseClient.rpc("unlock_chapter_with_coins", {
    p_story_id: storyId,
    p_chapter_id: chapter.id
  });

  if (error) {
    if (error.message?.includes("INSUFFICIENT_COINS")) {
      toast("Không đủ xu để mở chương này.");
    } else if (error.message?.includes("LOGIN_REQUIRED")) {
      openAuthModal();
      toast("Đăng nhập trước rồi mở khóa chương nha.");
    } else {
      toast("Mở khóa chưa thành công. Thử lại sau nha.");
    }
    return false;
  }

  const result = Array.isArray(data) ? data[0] : data;
  await loadAccountSummary();
  renderAccount();
  toast(result?.charged
    ? `Đã trừ ${Number(result.price_coins || 0).toLocaleString("vi-VN")} xu và mở chương.`
    : "Chương này đã được mở cho tài khoản của bạn.");
  return true;
}

function renderAccount() {
  if (!supabaseClient) {
    els.account.innerHTML = `
      <span class="status-chip vip">Đọc miễn phí</span>
      <a class="btn btn-primary" href="#/library">Chọn truyện</a>
    `;
    return;
  }

  if (!isLoggedIn()) {
    els.account.innerHTML = `
      <span class="status-chip">Chưa đăng nhập</span>
      <button class="btn btn-primary" data-open-auth>Đăng nhập</button>
    `;
    return;
  }

  els.account.innerHTML = `
    <a class="account-name" href="#/account">
      <strong>${escapeHtml(accountDisplayName())}</strong>
      <small>${hasAccountVip() ? `VIP còn ${vipDaysLeft()} ngày` : "Tài khoản thường"}</small>
    </a>
    ${isAdminUser ? `<a class="btn btn-secondary" href="#/admin">Admin</a>` : ""}
    <button class="btn btn-secondary" data-sign-out>Thoát</button>
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
  const progress = getStoryProgress(story);
  const hasImageCover = isImageCover(story.cover);
  return `
    <article class="story-card">
      <a href="#/story/${story.id}" class="cover ${hasImageCover ? "image-cover" : ""}" style="${coverStyle(story.cover)}">
        <strong>${story.title}</strong>
      </a>
      <div class="story-body">
        <div class="tags">${story.genre.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <h3>${story.title}</h3>
        <div class="story-meta">${story.author} · ${story.reads.toLocaleString("vi-VN")} lượt đọc · ${story.rating}/5</div>
        <p>${story.summary}</p>
        <div class="progress-bar" aria-label="Tiến độ đọc miễn phí">
          <span style="width:${progress}%"></span>
        </div>
        <div class="card-footer">
          <span class="muted">${story.chapters.length} chương · đọc miễn phí</span>
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
      <div class="hero-main image-hero" style="${coverStyle(lastStory.cover, "hero")}">
        <span class="eyebrow">Truyện phế thổ đang đăng</span>
        <h1>Phế Thổ: Ta Nhặt Được Cả Thế Giới</h1>
        <p>Thư viện đọc truyện tiếng Việt có dấu, tối ưu cho đọc dài, có phần nghe audio và lưu chương đang đọc. Hiện tại toàn bộ chương được mở miễn phí.</p>
        <div class="hero-kpis">
          <span>${lastStory.chapters.length} chương</span>
          <span>${lastStory.reads.toLocaleString("vi-VN")} lượt đọc</span>
          <span>${lastStory.rating}/5 đánh giá</span>
        </div>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/read/${lastStory.id}/${lastChapter.id}">Đọc tiếp</a>
          <a class="btn btn-secondary" href="#/story/${lastStory.id}">Danh sách chương</a>
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
          <div class="metric"><span class="muted">Trạng thái</span><strong>Free</strong></div>
          <div class="metric"><span class="muted">Audio</span><strong>2 giọng</strong></div>
          <div class="metric"><span class="muted">Bình luận</span><strong>Có</strong></div>
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
        <span class="eyebrow">Trạng thái đọc</span>
        <h2>Đọc miễn phí</h2>
      </div>
    </div>
    <section class="plans-grid">
      <article class="payment-card">
        <span class="eyebrow">Truyện 2K</span>
        <h3>Đọc tự do</h3>
        <p>Thanh toán tạm thời đã tắt. Người đọc có thể vào từng chương để đọc và nghe audio ngay.</p>
        <a class="btn btn-primary" href="#/library">Vào thư viện</a>
      </article>
    </section>
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
      <span class="status-chip vip">Tất cả chương miễn phí</span>
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
      <div class="detail-cover" style="${coverStyle(story.cover, "detail")}">
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
          <a class="btn btn-secondary" href="#/library">Xem thư viện</a>
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
  const readable = canRead(storyId, chapter);
  const price = chapterPriceCoins(chapter);
  const label = chapter.free !== false
    ? "Miễn phí"
    : readable
      ? (isVip() ? "VIP" : "Đã mở")
      : `${price.toLocaleString("vi-VN")} xu`;
  return `
    <article class="chapter-row">
      <div>
        <strong>${chapter.title}</strong>
        <span class="muted">${label}</span>
      </div>
      ${readable
        ? `<a class="btn btn-primary" href="#/read/${storyId}/${chapter.id}">Đọc</a>`
        : `<button class="btn btn-primary" data-unlock-chapter="${storyId}:${chapter.id}">Mở khóa</button>`}
    </article>
  `;
}

function renderChapterNav(story, prev, next, extraClass = "") {
  return `
    <nav class="reader-nav ${extraClass}" aria-label="Chuyển chương">
      ${prev ? `<a class="btn btn-secondary" href="#/read/${story.id}/${prev.id}">Chương trước</a>` : "<span></span>"}
      ${next ? `<a class="btn btn-primary" href="#/read/${story.id}/${next.id}" data-audio-next>Chương sau</a>` : "<span></span>"}
    </nav>
  `;
}

function renderAudioPanel(story, chapter, readable, prev, next) {
  if (!readable) return "";
  const voiceId = selectedAudioVoice();
  const speed = selectedAudioSpeed();
  const audioUrl = chapterAudioUrl(chapter, voiceId);
  const voiceLabel = audioVoicePresets.find((voice) => voice.id === voiceId)?.label || "Hoài My - nữ Việt";
  const nativePlayer = audioUrl
    ? `<audio controls preload="metadata" src="${escapeHtml(audioUrl)}" data-generated-audio></audio>`
    : "";
  const modeText = audioUrl
    ? `Đang có MP3 Edge gen sẵn cho giọng ${voiceLabel}. Player bên dưới kéo tua qua lại được.`
    : `Chưa có MP3 cho giọng ${voiceLabel}. Cần gen audio trước khi bật nghe.`;
  const audioActions = audioUrl
    ? `
        <button class="btn btn-primary" data-speak-chapter="${story.id}:${chapter.id}">Nghe chương</button>
        <button class="btn btn-secondary" data-pause-speech>Tạm dừng / tiếp tục</button>
        <button class="btn btn-secondary" data-stop-speech>Dừng</button>
      `
    : `<button class="btn btn-secondary" disabled>Chưa có MP3</button>`;

  return `
    <section class="audio-panel" data-audio-panel="${story.id}:${chapter.id}">
      <div>
        <span class="eyebrow">Nghe truyện</span>
        <h2>Audio chương này</h2>
        <p class="muted">${modeText}</p>
      </div>
      <div class="audio-controls">
        <label>
          <span>Giọng đọc</span>
          <select data-audio-voice>
            ${audioVoicePresets.map((voice) => `
              <option value="${voice.id}" ${voice.id === voiceId ? "selected" : ""}>${voice.label}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>Tốc độ</span>
          <select data-audio-speed>
            ${audioSpeedOptions.map((option) => `
              <option value="${option}" ${option === speed ? "selected" : ""}>${option}x</option>
            `).join("")}
          </select>
        </label>
      </div>
      ${nativePlayer}
      <div class="audio-progress" aria-label="Tiến trình nghe">
        <span data-audio-progress style="width:0%"></span>
      </div>
      <label class="audio-seek">
        <span>Tua audio</span>
        <input type="range" min="0" max="100" value="0" step="0.1" data-audio-seek />
      </label>
      <div class="audio-actions">
        ${audioActions}
      </div>
      ${renderChapterNav(story, prev, next, "audio-chapter-nav")}
      <p class="audio-status"><span data-audio-status>${audioUrl ? "Sẵn sàng phát MP3 Edge." : "Chưa có file MP3 cho giọng này."}</span> <strong data-audio-progress-text>0%</strong></p>
    </section>
  `;
}

async function renderReader(storyId, chapterId) {
  const story = getStory(storyId);
  const chapter = getChapter(storyId, chapterId);
  if (!story || !chapter) return renderNotFound();

  state.readerSize = clampReaderSize(state.readerSize);
  document.documentElement.style.setProperty("--reader-size", `${state.readerSize}px`);
  document.body.classList.toggle("reader-dark", state.darkReader);

  const index = story.chapters.findIndex((item) => item.id === chapter.id);
  const prev = story.chapters[index - 1];
  const next = story.chapters[index + 1];
  let readable = canRead(storyId, chapter);
  let readerChapter = chapter;

  if (readable) {
    try {
      const dbChapter = await loadChapterForReader(storyId, chapterId);
      readable = Boolean(dbChapter.can_read);
      readerChapter = { ...chapter, ...dbChapter };
    } catch {
      readable = false;
    }
  }

  if (readable) {
    state.lastRead = { storyId, chapterId };
    saveState();
    saveReadingProgress(storyId, chapterId).catch(() => {});
  }

  els.view.innerHTML = `
    <article class="reader">
      <h1>${escapeHtml(chapter.title)}</h1>
      <p class="muted reader-meta">${escapeHtml(story.title)} · ${chapter.free !== false ? "Chương miễn phí" : `${chapterPriceCoins(chapter).toLocaleString("vi-VN")} xu`}</p>
      <div class="reader-toolbar">
        <a class="btn btn-secondary" href="#/story/${story.id}">Danh sách chương</a>
        ${renderChapterNav(story, prev, next, "reader-nav-top")}
        <div class="reader-settings">
          <button class="icon-btn" data-reader-size="-1" aria-label="Giảm cỡ chữ">A-</button>
          <button class="icon-btn" data-reader-size="1" aria-label="Tăng cỡ chữ">A+</button>
          <button class="btn btn-secondary" id="toggleReaderTheme">${state.darkReader ? "Nền sáng" : "Nền tối"}</button>
        </div>
      </div>
      ${
        readable
          ? `${renderAudioPanel(story, readerChapter, readable, prev, next)}<section class="reader-content">${readerChapter.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</section>`
          : paywallBlock(storyId, chapter)
      }
      ${renderChapterNav(story, prev, next, "reader-nav-bottom")}
      ${renderComments(story.id, chapter.id)}
    </article>
  `;
  applyGeneratedAudioSpeed();
}

function paywallBlock(storyId, chapter) {
  const price = chapterPriceCoins(chapter);
  return `
    <section class="paywall">
      <span class="eyebrow">Chương tính phí</span>
      <h2>${chapter.title}</h2>
      <p>Chương này cần ${price.toLocaleString("vi-VN")} xu để mở. Sau khi mở, hệ thống lưu vào tài khoản nên lần sau đăng nhập lại vẫn đọc được.</p>
      <div class="paywall-actions">
        <button class="btn btn-primary" data-unlock-chapter="${storyId}:${chapter.id}">Mở khóa bằng xu</button>
        <a class="btn btn-secondary" href="#/account">Xem tài khoản</a>
      </div>
    </section>
  `;
}

function renderWallet() {
  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Đọc miễn phí</span>
        <h1>Thanh toán đang tạm tắt</h1>
      </div>
      <span class="status-chip vip">Tất cả chương miễn phí</span>
    </div>
    <section class="plans-grid">
      <article class="payment-card">
        <span class="eyebrow">Truyện 2K</span>
        <h3>Không cần thanh toán</h3>
        <p>Giai đoạn này site mở free cho độc giả đọc và nghe truyện trước.</p>
        <a class="btn btn-primary" href="#/library">Vào thư viện</a>
      </article>
    </section>
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

async function renderAdmin() {
  if (!supabaseClient) {
    els.view.innerHTML = emptyState("Chưa cấu hình Supabase nên không mở được admin.");
    return;
  }
  if (!isLoggedIn()) {
    els.view.innerHTML = `
      <div class="page-title">
        <div>
          <span class="eyebrow">Quản trị</span>
          <h1>Đăng nhập tài khoản admin</h1>
        </div>
        <button class="btn btn-primary" data-open-auth>Đăng nhập</button>
      </div>
      <section class="panel">
        <p class="muted">Trang này chỉ mở cho account nằm trong bảng admin_users của Supabase.</p>
      </section>
    `;
    return;
  }

  await loadAdminStatus();
  if (!isAdminUser) {
    els.view.innerHTML = `
      <div class="page-title">
        <div>
          <span class="eyebrow">Quản trị</span>
          <h1>Chưa có quyền admin</h1>
          <p class="muted">${escapeHtml(accountEmail())}</p>
        </div>
        <a class="btn btn-secondary" href="#/account">Về tài khoản</a>
      </div>
      <section class="panel">
        <p class="muted">Cần chạy file ADMIN_SETUP.sql trong Supabase và thêm email này vào admin_users trước.</p>
      </section>
    `;
    return;
  }

  await loadAdminData();
  if (adminState.error) {
    els.view.innerHTML = emptyState(`Không tải được admin: ${adminState.error}`);
    return;
  }

  const selectedStoryId = state.admin?.storyId || adminState.stories[0]?.id || "";
  const selectedChapterId = state.admin?.chapterId || adminState.chapters[0]?.chapter_id || "";
  state.admin = { storyId: selectedStoryId, chapterId: selectedChapterId };
  const selectedStory = adminState.stories.find((story) => story.id === selectedStoryId) || adminState.stories[0];
  const selectedChapter = adminState.chapters.find((chapter) => chapter.chapter_id === selectedChapterId) || adminState.chapters[0];
  const hiddenComments = adminState.comments.filter((comment) => comment.is_hidden).length;

  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Quản trị</span>
        <h1>Admin Truyện 2K</h1>
        <p class="muted">Mọi thay đổi lưu thẳng vào Supabase, độc giả không sửa được từ frontend.</p>
      </div>
      <button class="btn btn-secondary" data-admin-refresh>Làm mới</button>
    </div>

    <section class="metrics-grid">
      <div class="metric"><span class="muted">Truyện</span><strong>${adminState.stories.length}</strong></div>
      <div class="metric"><span class="muted">Chương đang chọn</span><strong>${adminState.chapters.length}</strong></div>
      <div class="metric"><span class="muted">Comment gần đây</span><strong>${adminState.comments.length}</strong></div>
      <div class="metric"><span class="muted">Comment ẩn</span><strong>${hiddenComments}</strong></div>
    </section>

    <section class="panel admin-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Quyền tối cao</span>
          <h2>Cộng / trừ xu tài khoản bất kỳ</h2>
        </div>
      </div>
      <form class="admin-form admin-coin-form" data-admin-coin-adjust-form>
        <label>
          <span>Email account</span>
          <input name="email" type="email" placeholder="docgia@example.com" required />
        </label>
        <label>
          <span>Số xu cộng/trừ</span>
          <input name="amount" type="number" placeholder="Ví dụ 1000 hoặc -500" required />
        </label>
        <label class="admin-field-wide">
          <span>Lý do ghi lịch sử</span>
          <input name="reason" value="admin_adjust" />
        </label>
        <button class="btn btn-primary" type="submit">Cập nhật xu và ghi lịch sử</button>
      </form>
      ${renderAdminTransactions()}
    </section>

    <section class="admin-layout">
      <article class="panel admin-panel">
        <div class="section-head compact">
          <div>
            <span class="eyebrow">Truyện</span>
            <h2>Thông tin truyện</h2>
          </div>
        </div>
        <label class="admin-field">
          <span>Chọn truyện</span>
          <select data-admin-story-select>
            ${adminState.stories.map((story) => `<option value="${escapeHtml(story.id)}" ${story.id === selectedStoryId ? "selected" : ""}>${escapeHtml(story.title)}</option>`).join("")}
          </select>
        </label>
        ${selectedStory ? renderAdminStoryForm(selectedStory) : emptyState("Chưa có truyện trong database.")}
      </article>

      <article class="panel admin-panel">
        <div class="section-head compact">
          <div>
            <span class="eyebrow">Chương</span>
            <h2>Sửa chương</h2>
          </div>
        </div>
        <label class="admin-field">
          <span>Chọn chương</span>
          <select data-admin-chapter-select>
            ${adminState.chapters.map((chapter) => `<option value="${escapeHtml(chapter.chapter_id)}" ${chapter.chapter_id === selectedChapterId ? "selected" : ""}>${escapeHtml(chapter.title)}</option>`).join("")}
          </select>
        </label>
        ${selectedChapter ? renderAdminChapterForm(selectedChapter, adminState.chapterBody) : emptyState("Chưa chọn chương.")}
      </article>
    </section>

    <section class="panel admin-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Bình luận</span>
          <h2>Comment gần đây</h2>
        </div>
      </div>
      ${renderAdminComments()}
    </section>

    <section class="panel admin-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">User</span>
          <h2>Tài khoản và ví xu</h2>
        </div>
      </div>
      ${renderAdminUsers()}
    </section>
  `;
}

function renderAdminStoryForm(story) {
  return `
    <form class="admin-form" data-admin-story-form>
      <input name="id" type="hidden" value="${escapeHtml(story.id)}" />
      <label><span>Tiêu đề</span><input name="title" value="${escapeHtml(story.title)}" required /></label>
      <label><span>Tác giả</span><input name="author" value="${escapeHtml(story.author)}" required /></label>
      <label><span>Trạng thái</span><input name="status" value="${escapeHtml(story.status || "")}" /></label>
      <label><span>Ngày cập nhật</span><input name="updated_at" type="date" value="${escapeHtml(story.updated_at || "")}" /></label>
      <label><span>Lượt đọc</span><input name="reads" type="number" min="0" value="${Number(story.reads || 0)}" /></label>
      <label><span>Rating</span><input name="rating" type="number" min="0" max="5" step="0.1" value="${Number(story.rating || 0)}" /></label>
      <label class="admin-field-wide"><span>Tóm tắt</span><textarea name="summary" rows="5">${escapeHtml(story.summary || "")}</textarea></label>
      <label class="admin-check"><input name="is_active" type="checkbox" ${story.is_active ? "checked" : ""} /> <span>Đang hiển thị ngoài web</span></label>
      <button class="btn btn-primary" type="submit">Lưu truyện</button>
    </form>
  `;
}

function renderAdminChapterForm(chapter, bodyLines) {
  return `
    <form class="admin-form" data-admin-chapter-form>
      <input name="story_id" type="hidden" value="${escapeHtml(chapter.story_id)}" />
      <input name="chapter_id" type="hidden" value="${escapeHtml(chapter.chapter_id)}" />
      <label><span>Tiêu đề</span><input name="title" value="${escapeHtml(chapter.title)}" required /></label>
      <label><span>Tập / cụm chương</span><input name="episode_title" value="${escapeHtml(chapter.episode_title || "")}" /></label>
      <label><span>Thứ tự</span><input name="sort_order" type="number" value="${Number(chapter.sort_order || 0)}" /></label>
      <label><span>Giá xu</span><input name="price_coins" type="number" min="0" value="${Number(chapter.price_coins || 0)}" /></label>
      <label class="admin-field-wide"><span>Audio mặc định</span><input name="audio_url" value="${escapeHtml(chapter.audio_url || "")}" /></label>
      <label class="admin-field-wide"><span>Audio URLs JSON</span><textarea name="audio_urls" rows="4">${escapeHtml(JSON.stringify(chapter.audio_urls || {}, null, 2))}</textarea></label>
      <label class="admin-field-wide"><span>Nội dung chương, mỗi dòng là một đoạn</span><textarea name="body" rows="14">${escapeHtml((bodyLines || []).join("\n"))}</textarea></label>
      <label class="admin-check"><input name="free" type="checkbox" ${chapter.free ? "checked" : ""} /> <span>Miễn phí</span></label>
      <label class="admin-check"><input name="is_active" type="checkbox" ${chapter.is_active ? "checked" : ""} /> <span>Đang hiển thị ngoài web</span></label>
      <button class="btn btn-primary" type="submit">Lưu chương</button>
    </form>
  `;
}

function renderAdminComments() {
  if (!adminState.comments.length) return emptyState("Chưa có bình luận.");
  return `
    <table class="admin-table">
      <thead><tr><th>Người gửi</th><th>Nội dung</th><th>Vị trí</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>
        ${adminState.comments.map((comment) => `
          <tr>
            <td><strong>${escapeHtml(comment.author)}</strong><br><span class="muted">${escapeHtml(comment.user_email || "")}</span></td>
            <td>${escapeHtml(comment.body).slice(0, 220)}</td>
            <td>${escapeHtml(comment.target_key)}<br><span class="muted">${new Date(comment.created_at).toLocaleString("vi-VN")}</span></td>
            <td>${comment.is_hidden ? "Đã ẩn" : "Đang hiện"}</td>
            <td class="admin-actions">
              <button class="btn btn-secondary" data-admin-comment-toggle="${comment.id}" data-hidden="${comment.is_hidden ? "0" : "1"}">${comment.is_hidden ? "Hiện" : "Ẩn"}</button>
              <button class="btn btn-danger" data-admin-comment-delete="${comment.id}">Xóa</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAdminUsers() {
  if (!adminState.profiles.length) return emptyState("Chưa có user profile.");
  return `
    <table class="admin-table">
      <thead><tr><th>Email</th><th>Tên</th><th>Xu</th><th>VIP</th><th></th></tr></thead>
      <tbody>
        ${adminState.profiles.map((profile) => {
          const wallet = adminState.wallets.find((item) => item.user_id === profile.id) || {};
          const vip = adminState.vip.find((item) => item.user_id === profile.id && new Date(item.active_until).getTime() > Date.now()) || {};
          return `
            <tr>
              <td>${escapeHtml(profile.email || profile.id)}</td>
              <td>${escapeHtml(profile.display_name || "")}</td>
              <td>
                <form class="admin-inline-form" data-admin-wallet-form="${profile.id}">
                  <input name="coin_balance" type="number" min="0" value="${Number(wallet.coin_balance || 0)}" />
                  <input name="balance_vnd" type="number" min="0" value="${Number(wallet.balance_vnd || 0)}" />
                  <button class="btn btn-secondary" type="submit">Lưu ví</button>
                </form>
              </td>
              <td>
                <form class="admin-inline-form" data-admin-vip-form="${profile.id}">
                  <input name="active_until" type="datetime-local" value="${vip.active_until ? new Date(vip.active_until).toISOString().slice(0, 16) : ""}" />
                  <button class="btn btn-secondary" type="submit">Lưu VIP</button>
                </form>
              </td>
              <td><span class="muted">${new Date(profile.updated_at || Date.now()).toLocaleString("vi-VN")}</span></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderAdminTransactions() {
  if (!adminState.transactions.length) return `<p class="muted">Chưa có lịch sử xu.</p>`;
  return `
    <table class="admin-table admin-subtable">
      <thead><tr><th>Email</th><th>Số xu</th><th>Lý do</th><th>Thời gian</th></tr></thead>
      <tbody>
        ${adminState.transactions.slice(0, 20).map((tx) => {
          const profile = adminState.profiles.find((item) => item.id === tx.user_id) || {};
          const amount = Number(tx.amount || 0);
          return `
            <tr>
              <td>${escapeHtml(profile.email || tx.user_id)}</td>
              <td><strong>${amount > 0 ? "+" : ""}${amount.toLocaleString("vi-VN")}</strong></td>
              <td>${escapeHtml(tx.reason || "")}</td>
              <td>${new Date(tx.created_at).toLocaleString("vi-VN")}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderAccountPage() {
  if (!supabaseClient) {
    els.view.innerHTML = emptyState("Chưa cấu hình Supabase.");
    return;
  }
  if (!isLoggedIn()) {
    els.view.innerHTML = `
      <div class="page-title">
        <div>
          <span class="eyebrow">Tài khoản</span>
          <h1>Đăng nhập để lưu VIP và tiến độ đọc</h1>
        </div>
        <button class="btn btn-primary" data-open-auth>Đăng nhập</button>
      </div>
      <section class="panel">
        <p class="muted">Sau khi đăng nhập, hệ thống sẽ biết tài khoản nào có VIP, còn bao nhiêu ngày, ví còn bao nhiêu, đang đọc tới chương nào và đã mở chương nào.</p>
      </section>
    `;
    return;
  }

  const progress = currentAccountProgress();
  const progressStory = getStory(progress.story_id || progress.storyId) || stories[0];
  const progressChapter = getChapter(progressStory.id, progress.chapter_id || progress.chapterId) || progressStory.chapters[0];
  const activeVip = accountSummary.vip.filter((item) => new Date(item.active_until).getTime() > Date.now());
  const unlockedCount = accountSummary.unlocked.length;
  const wallet = accountSummary.wallet || { balance_vnd: 0, coin_balance: 0 };

  els.view.innerHTML = `
    <div class="page-title">
      <div>
        <span class="eyebrow">Tài khoản</span>
        <h1>${escapeHtml(accountDisplayName())}</h1>
        <p class="muted">${escapeHtml(accountEmail())}</p>
      </div>
      <button class="btn btn-secondary" data-sign-out>Đăng xuất</button>
    </div>

    <section class="metrics-grid">
      <div class="metric"><span class="muted">VIP</span><strong>${hasAccountVip() ? `${vipDaysLeft()} ngày` : "Chưa có"}</strong></div>
      <div class="metric"><span class="muted">Số dư</span><strong>${money(wallet.balance_vnd || 0)}</strong></div>
      <div class="metric"><span class="muted">Xu</span><strong>${Number(wallet.coin_balance || 0).toLocaleString("vi-VN")}</strong></div>
      <div class="metric"><span class="muted">Chương đã mở</span><strong>${unlockedCount}</strong></div>
    </section>

    <section class="panel account-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Đang đọc</span>
          <h2>${progressChapter.title}</h2>
        </div>
        <a class="btn btn-primary" href="#/read/${progressStory.id}/${progressChapter.id}">Đọc tiếp</a>
      </div>
      <p class="muted">${progressStory.title}</p>
    </section>

    <section class="panel account-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">VIP</span>
          <h2>Lịch sử gói</h2>
        </div>
        <span class="status-chip ${hasAccountVip() ? "vip" : ""}">${hasAccountVip() ? "Đang hoạt động" : "Chưa kích hoạt"}</span>
      </div>
      ${activeVip.length ? `
        <div class="account-list">
          ${activeVip.map((item) => `
            <article class="account-list-item">
              <strong>${escapeHtml(item.plan_id)}</strong>
              <span>Còn tới ${new Date(item.active_until).toLocaleString("vi-VN")} · ${escapeHtml(item.source || "payment")}</span>
            </article>
          `).join("")}
        </div>
      ` : `<p class="muted">Tài khoản này chưa có VIP. Khi payment bật, gói mua sẽ ghi vào đây.</p>`}
    </section>

    <section class="panel account-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Mở khóa</span>
          <h2>Chương đã mở</h2>
        </div>
        <span class="status-chip">${unlockedCount} chương</span>
      </div>
      ${unlockedCount ? `
        <div class="account-list">
          ${accountSummary.unlocked.slice(0, 20).map((item) => {
            const story = getStory(item.story_id);
            const chapter = getChapter(item.story_id, item.chapter_id);
            return `
              <article class="account-list-item">
                <strong>${escapeHtml(chapter?.title || item.chapter_id)}</strong>
                <span>${escapeHtml(story?.title || item.story_id)} · ${new Date(item.created_at).toLocaleString("vi-VN")}</span>
              </article>
            `;
          }).join("")}
        </div>
      ` : `<p class="muted">Hiện toàn bộ truyện đang free nên chưa cần mở khóa chương riêng.</p>`}
    </section>

    <section class="panel account-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Ví xu</span>
          <h2>Lịch sử giao dịch</h2>
        </div>
        <span class="status-chip">${accountSummary.transactions.length} giao dịch</span>
      </div>
      ${accountSummary.transactions.length ? `
        <div class="account-list">
          ${accountSummary.transactions.map((item) => {
            const story = getStory(item.story_id);
            const chapter = getChapter(item.story_id, item.chapter_id);
            const amount = Number(item.amount || 0);
            return `
              <article class="account-list-item">
                <strong>${amount > 0 ? "+" : ""}${amount.toLocaleString("vi-VN")} xu</strong>
                <span>${escapeHtml(chapter?.title || item.reason)}${story ? ` · ${escapeHtml(story.title)}` : ""} · ${new Date(item.created_at).toLocaleString("vi-VN")}</span>
              </article>
            `;
          }).join("")}
        </div>
      ` : `<p class="muted">Chưa có giao dịch xu nào.</p>`}
    </section>
  `;
}

function openAuthModal() {
  if (!supabaseClient) {
    toast("Chưa cấu hình Supabase Auth.");
    return;
  }
  pendingEmailOtp = null;
  els.checkout.innerHTML = `
    <span class="eyebrow">Tài khoản</span>
    <h2 id="checkoutTitle">Đăng nhập Truyện 2K</h2>
    <p class="muted">Tạo tài khoản bằng email. Supabase sẽ gửi link xác nhận, bấm link trong email để hoàn tất.</p>
    <form class="auth-form" data-auth-form>
      <label>
        <span>Email</span>
        <input name="email" type="email" autocomplete="email" placeholder="ban@example.com" required />
      </label>
      <label>
        <span>Mật khẩu</span>
        <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Tối thiểu 6 ký tự" />
      </label>
      <label>
        <span>Tên hiển thị</span>
        <input name="displayName" maxlength="40" autocomplete="nickname" placeholder="Tên độc giả" value="${escapeHtml(state.commenterName || "")}" />
      </label>
      <div class="auth-actions">
        <button class="btn btn-primary" type="submit" data-auth-action="signin">Đăng nhập</button>
        <button class="btn btn-secondary" type="submit" data-auth-action="signup">Tạo tài khoản + gửi link</button>
        <button class="btn btn-secondary" type="submit" data-auth-action="otp">Gửi link/mã đăng nhập</button>
      </div>
    </form>
  `;
  els.modal.hidden = false;
}

function renderOtpModal() {
  if (!pendingEmailOtp) return;
  const expiresAt = pendingEmailOtp.expiresAt || Date.now();
  const remainingMinutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
  els.checkout.innerHTML = `
    <span class="eyebrow">Xác nhận email</span>
    <h2 id="checkoutTitle">Mở email để xác nhận</h2>
    <p class="muted">Link/mã xác nhận đã gửi tới ${escapeHtml(pendingEmailOtp.email)} và chỉ có hiệu lực trong 20 phút. Còn khoảng ${remainingMinutes} phút. Nếu email có nút Confirm, bấm nút đó; nếu email có mã số thì nhập mã bên dưới.</p>
    <form class="auth-form" data-otp-form>
      <label>
        <span>Mã xác nhận</span>
        <input name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Nhập mã trong email" required />
      </label>
      <div class="auth-actions">
        <button class="btn btn-primary" type="submit">Xác nhận</button>
        <button class="btn btn-secondary" type="button" data-resend-otp>Gửi lại link/mã</button>
        <button class="btn btn-secondary" type="button" data-open-auth>Đổi email</button>
      </div>
    </form>
  `;
}

async function signInWithPassword(email, password) {
  if (!supabaseClient) return false;
  const cleanedEmail = String(email || "").trim().toLowerCase();
  if (!cleanedEmail || !password) {
    toast("Nhập email và mật khẩu trước nha.");
    return false;
  }
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: cleanedEmail,
    password
  });
  if (error) throw error;
  toast("Đã đăng nhập.");
  return true;
}

function authErrorMessage(error) {
  const code = error?.code || error?.error_code || "";
  const message = String(error?.message || "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được tạo/xác nhận.";
  }
  if (message.includes("email not confirmed")) {
    return "Email chưa xác nhận. Dùng nút gửi mã đăng nhập để xác nhận email trước.";
  }
  if (message.includes("rate limit")) {
    return "Gửi mã quá nhanh. Chờ một chút rồi thử lại.";
  }
  return "Chưa xử lý được tài khoản. Kiểm tra email/mật khẩu hoặc thử lại sau.";
}

async function sendEmailOtp(email, displayName, password = "", mode = "signin") {
  if (!supabaseClient) return false;
  const cleanedEmail = String(email || "").trim().toLowerCase();
  const cleanedName = cleanCommentAuthor(displayName || cleanedEmail.split("@")[0]);
  if (!cleanedEmail) {
    toast("Nhập email trước nha.");
    return false;
  }
  if (mode === "signup" && (!password || password.length < 6)) {
    toast("Mật khẩu cần tối thiểu 6 ký tự.");
    return false;
  }
  state.commenterName = cleanedName;
  saveState();
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = mode === "signup"
    ? await supabaseClient.auth.signUp({
      email: cleanedEmail,
      password,
      options: {
        data: { display_name: cleanedName },
        emailRedirectTo: redirectTo
      }
    })
    : await supabaseClient.auth.signInWithOtp({
      email: cleanedEmail,
      options: {
        shouldCreateUser: true,
        data: { display_name: cleanedName },
        emailRedirectTo: redirectTo
      }
    });
  if (error) throw error;
  pendingEmailOtp = {
    email: cleanedEmail,
    password: "",
    displayName: cleanedName,
    mode,
    expiresAt: Date.now() + EMAIL_OTP_EXPIRES_IN_MS
  };
  renderOtpModal();
  toast("Đã gửi link/mã xác nhận qua email. Hiệu lực trong 20 phút.");
  return true;
}

async function verifyEmailOtp(token) {
  if (!supabaseClient || !pendingEmailOtp) return false;
  const cleanedToken = String(token || "").trim().replace(/\s+/g, "");
  if (!cleanedToken) {
    toast("Nhập mã xác nhận trước nha.");
    return false;
  }
  if (Date.now() > Number(pendingEmailOtp.expiresAt || 0)) {
    renderOtpModal();
    toast(`Mã xác nhận đã quá 20 phút. Bấm gửi lại mã cho ${pendingEmailOtp.email}.`);
    return false;
  }

  const { data, error } = await supabaseClient.auth.verifyOtp({
    email: pendingEmailOtp.email,
    token: cleanedToken,
    type: "email"
  });
  if (error) throw error;

  authSession = data?.session || authSession;
  authUser = data?.user || authSession?.user || authUser;
  if (authUser) {
    state.commenterName = pendingEmailOtp.displayName || accountDisplayName();
    saveState();
  }

  if (pendingEmailOtp.mode === "signup" && pendingEmailOtp.password) {
    const { error: passwordError } = await supabaseClient.auth.updateUser({
      password: pendingEmailOtp.password,
      data: { display_name: pendingEmailOtp.displayName }
    });
    if (passwordError) throw passwordError;
  }

  pendingEmailOtp = null;
  await upsertProfile();
  await loadVipEntitlement();
  await loadAccountSummary();
  renderAccount();
  hydrateVisibleComments();
  toast("Đã xác nhận email và đăng nhập.");
  return true;
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  authSession = null;
  authUser = null;
  userVipUntil = null;
  renderAccount();
  hydrateVisibleComments();
  toast("Đã đăng xuất.");
}

async function saveAdminStory(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const payload = {
    title: normalizeText(values.title).trim(),
    author: normalizeText(values.author).trim(),
    status: normalizeText(values.status).trim() || "Đang ra",
    updated_at: values.updated_at || null,
    reads: Number(values.reads || 0),
    rating: Number(values.rating || 0),
    summary: normalizeText(values.summary).trim(),
    is_active: form.elements.is_active.checked,
    db_updated_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from("stories").update(payload).eq("id", values.id);
  if (error) throw error;
  await loadStoryCatalog();
  toast("Đã lưu truyện.");
}

function parseJsonField(value, fallback) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

async function saveAdminChapter(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const storyId = values.story_id;
  const chapterId = values.chapter_id;
  const bodyLines = normalizeText(values.body)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const audioUrls = parseJsonField(values.audio_urls, {});

  const chapterPayload = {
    title: normalizeText(values.title).trim(),
    episode_title: normalizeText(values.episode_title).trim() || null,
    sort_order: Number(values.sort_order || 0),
    free: form.elements.free.checked,
    price_coins: Number(values.price_coins || 0),
    audio_url: normalizeText(values.audio_url).trim() || null,
    audio_urls: audioUrls,
    is_active: form.elements.is_active.checked,
    db_updated_at: new Date().toISOString()
  };

  const { error: chapterError } = await supabaseClient
    .from("story_chapters")
    .update(chapterPayload)
    .eq("story_id", storyId)
    .eq("chapter_id", chapterId);
  if (chapterError) throw chapterError;

  const { error: bodyError } = await supabaseClient
    .from("story_chapter_bodies")
    .upsert({
      story_id: storyId,
      chapter_id: chapterId,
      body: bodyLines,
      db_updated_at: new Date().toISOString()
    }, { onConflict: "story_id,chapter_id" });
  if (bodyError) throw bodyError;

  authorizedChapterCache.delete(chapterKey(storyId, chapterId));
  await loadStoryCatalog();
  toast("Đã lưu chương.");
}

async function setAdminCommentVisibility(commentId, hidden) {
  const { error } = await supabaseClient
    .from("comments")
    .update({ is_hidden: hidden })
    .eq("id", commentId);
  if (error) throw error;
  toast(hidden ? "Đã ẩn bình luận." : "Đã hiện bình luận.");
}

async function deleteAdminComment(commentId) {
  const { error } = await supabaseClient.from("comments").delete().eq("id", commentId);
  if (error) throw error;
  toast("Đã xóa bình luận.");
}

async function saveAdminWallet(form, userId) {
  const values = Object.fromEntries(new FormData(form).entries());
  const { error } = await supabaseClient
    .from("account_wallets")
    .upsert({
      user_id: userId,
      balance_vnd: Number(values.balance_vnd || 0),
      coin_balance: Number(values.coin_balance || 0),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  if (error) throw error;
  toast("Đã lưu ví user.");
}

async function adjustAdminCoins(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const email = normalizeText(values.email).trim().toLowerCase();
  const amount = Number(values.amount || 0);
  const reason = normalizeText(values.reason).trim() || "admin_adjust";
  if (!email || !amount) {
    toast("Nhập email và số xu khác 0.");
    return;
  }

  const { error } = await supabaseClient.rpc("admin_adjust_user_coins", {
    p_email: email,
    p_amount: amount,
    p_reason: reason
  });
  if (error) throw error;
  toast(`${amount > 0 ? "Đã cộng" : "Đã trừ"} ${Math.abs(amount).toLocaleString("vi-VN")} xu cho ${email}.`);
}

async function saveAdminVip(form, userId) {
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.active_until) {
    const { error } = await supabaseClient.from("vip_entitlements").delete().eq("user_id", userId).eq("plan_id", "vip");
    if (error) throw error;
    toast("Đã tắt VIP user.");
    return;
  }
  const { error } = await supabaseClient
    .from("vip_entitlements")
    .upsert({
      user_id: userId,
      plan_id: "vip",
      active_until: new Date(values.active_until).toISOString(),
      source: "admin",
      created_at: new Date().toISOString()
    }, { onConflict: "user_id,plan_id" });
  if (error) throw error;
  toast("Đã lưu VIP user.");
}

function emptyState(text) {
  return `<div class="panel"><p class="muted">${text}</p></div>`;
}

function renderNotFound() {
  els.view.innerHTML = emptyState("Không tìm thấy trang này.");
}

function renderCatalogGate() {
  if (!storyCatalogReady) {
    els.view.innerHTML = emptyState("Đang tải dữ liệu truyện từ database...");
    return false;
  }
  if (storyCatalogError || !stories.length) {
    els.view.innerHTML = emptyState(storyCatalogError || "Database chưa có truyện nào.");
    return false;
  }
  return true;
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  els.toastStack.append(item);
  setTimeout(() => item.remove(), 3200);
}

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  if (isAuthRedirectHash()) {
    els.view.innerHTML = emptyState("Đang xác nhận email, chờ một chút nha...");
    return;
  }
  const shouldScrollTop = hash !== activeRouteHash;
  if (shouldScrollTop) stopSpeech();
  activeRouteHash = hash;
  const [_, routeName, id, chapterId] = hash.split("/");
  document.body.classList.toggle("reader-dark", state.darkReader && routeName === "read");
  setActiveNav(hash);

  if (!renderCatalogGate()) return;

  if (hash === "/") renderHome();
  else if (routeName === "library") renderLibrary();
  else if (routeName === "story") renderStory(id);
  else if (routeName === "read") await renderReader(id, chapterId);
  else if (routeName === "account") renderAccountPage();
  else if (routeName === "wallet") renderLibrary();
  else if (routeName === "admin") await renderAdmin();
  else renderNotFound();
  hydrateVisibleComments();
  els.view.focus({ preventScroll: true });
  if (shouldScrollTop) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-open-auth]")) {
    openAuthModal();
  }

  if (event.target.closest("[data-admin-refresh]")) {
    event.preventDefault();
    await renderAdmin();
  }

  const commentToggle = event.target.closest("[data-admin-comment-toggle]");
  if (commentToggle) {
    event.preventDefault();
    commentToggle.disabled = true;
    try {
      await setAdminCommentVisibility(commentToggle.dataset.adminCommentToggle, commentToggle.dataset.hidden === "1");
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa cập nhật được bình luận.");
      commentToggle.disabled = false;
    }
  }

  const commentDelete = event.target.closest("[data-admin-comment-delete]");
  if (commentDelete) {
    event.preventDefault();
    if (!confirm("Xóa bình luận này?")) return;
    commentDelete.disabled = true;
    try {
      await deleteAdminComment(commentDelete.dataset.adminCommentDelete);
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa xóa được bình luận.");
      commentDelete.disabled = false;
    }
  }

  if (event.target.closest("[data-sign-out]")) {
    signOut();
  }

  if (event.target.closest("[data-resend-otp]")) {
    event.preventDefault();
    const pending = pendingEmailOtp;
    if (pending) {
      await sendEmailOtp(pending.email, pending.displayName, pending.password, pending.mode);
    }
  }

  const unlockButton = event.target.closest("[data-unlock-chapter]");
  if (unlockButton) {
    event.preventDefault();
    const [storyId, chapterId] = unlockButton.dataset.unlockChapter.split(":");
    const chapter = getChapter(storyId, chapterId);
    unlockButton.disabled = true;
    if (chapter && await unlockChapter(storyId, chapter)) route();
    unlockButton.disabled = false;
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
    if (chapter) await playAudioForChapter(storyId, chapter);
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

});

document.addEventListener("submit", async (event) => {
  const otpForm = event.target.closest("[data-otp-form]");
  if (otpForm) {
    event.preventDefault();
    const button = otpForm.querySelector("button[type='submit']");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Đang xác nhận...";
    try {
      if (await verifyEmailOtp(otpForm.elements.token.value)) {
        els.modal.hidden = true;
      }
    } catch {
      toast("Mã xác nhận không đúng hoặc đã hết hạn.");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    return;
  }

  const adminStoryForm = event.target.closest("[data-admin-story-form]");
  if (adminStoryForm) {
    event.preventDefault();
    const button = adminStoryForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await saveAdminStory(adminStoryForm);
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa lưu được truyện.");
      button.disabled = false;
    }
    return;
  }

  const adminChapterForm = event.target.closest("[data-admin-chapter-form]");
  if (adminChapterForm) {
    event.preventDefault();
    const button = adminChapterForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await saveAdminChapter(adminChapterForm);
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa lưu được chương. Kiểm tra JSON audio URLs.");
      button.disabled = false;
    }
    return;
  }

  const adminWalletForm = event.target.closest("[data-admin-wallet-form]");
  if (adminWalletForm) {
    event.preventDefault();
    const button = adminWalletForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await saveAdminWallet(adminWalletForm, adminWalletForm.dataset.adminWalletForm);
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa lưu được ví.");
      button.disabled = false;
    }
    return;
  }

  const adminCoinAdjustForm = event.target.closest("[data-admin-coin-adjust-form]");
  if (adminCoinAdjustForm) {
    event.preventDefault();
    const button = adminCoinAdjustForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await adjustAdminCoins(adminCoinAdjustForm);
      adminCoinAdjustForm.reset();
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa cập nhật được xu.");
      button.disabled = false;
    }
    return;
  }

  const adminVipForm = event.target.closest("[data-admin-vip-form]");
  if (adminVipForm) {
    event.preventDefault();
    const button = adminVipForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await saveAdminVip(adminVipForm, adminVipForm.dataset.adminVipForm);
      await renderAdmin();
    } catch (error) {
      toast(error.message || "Chưa lưu được VIP.");
      button.disabled = false;
    }
    return;
  }

  const authForm = event.target.closest("[data-auth-form]");
  if (authForm) {
    event.preventDefault();
    const button = event.submitter || authForm.querySelector("button[type='submit']");
    const action = button?.dataset.authAction || "signin";
    const email = authForm.elements.email.value;
    const password = authForm.elements.password.value;
    const displayName = authForm.elements.displayName.value;
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Đang xử lý...";
    try {
      const ok = action === "signup" || action === "otp"
        ? await sendEmailOtp(email, displayName, password, action)
        : await signInWithPassword(email, password);
      if (ok && action === "signin") {
        els.modal.hidden = true;
      }
    } catch (error) {
      toast(authErrorMessage(error));
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    return;
  }

  const form = event.target.closest("[data-comment-form]");
  if (!form) return;
  event.preventDefault();
  const storyId = form.dataset.commentForm;
  const chapterId = form.dataset.commentChapter || "story";
  const input = form.elements.comment;
  const authorInput = form.elements.author;
  if (form.elements.website?.value) return;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Đang gửi...";
  try {
    if (await addComment(storyId, chapterId, authorInput?.value, input.value)) {
      input.value = "";
      if (authorInput) authorInput.value = state.commenterName || "";
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
  const adminStorySelect = event.target.closest("[data-admin-story-select]");
  if (adminStorySelect) {
    state.admin = { storyId: adminStorySelect.value, chapterId: "" };
    saveState();
    renderAdmin();
    return;
  }

  const adminChapterSelect = event.target.closest("[data-admin-chapter-select]");
  if (adminChapterSelect) {
    state.admin = { ...(state.admin || {}), chapterId: adminChapterSelect.value };
    saveState();
    renderAdmin();
    return;
  }

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
  const audioSeek = event.target.closest("[data-audio-seek]");
  if (audioSeek) {
    const percent = Number(audioSeek.value) || 0;
    const audio = currentGeneratedAudio();
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      const target = (percent / 100) * audio.duration;
      updateAudioProgress(percent, `${Math.round(percent)}%`);
      updateAudioStatus(`Tua tới ${formatAudioTime(target)} / ${formatAudioTime(audio.duration)}. Thả ra để phát từ đây.`);
      return;
    }
    updateAudioProgress(percent, `${percent}%`);
    return;
  }

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

document.addEventListener("change", (event) => {
  const voiceSelect = event.target.closest("[data-audio-voice]");
  if (voiceSelect) {
    state.audioVoice = voiceSelect.value;
    stopSpeech();
    saveState();
    route();
    return;
  }

  const speedSelect = event.target.closest("[data-audio-speed]");
  if (speedSelect) {
    state.audioSpeed = Number(speedSelect.value) || 1;
    saveState();
    applyGeneratedAudioSpeed();
    updateAudioStatus(`Đã đổi tốc độ sang ${selectedAudioSpeed()}x.`);
    if (speechState.playing && !speechState.paused) {
      getSpeech()?.cancel();
      setTimeout(speakNextChunk, 80);
    }
    return;
  }

  const audioSeek = event.target.closest("[data-audio-seek]");
  if (!audioSeek) return;
  if (seekGeneratedAudioToPercent(Number(audioSeek.value) || 0, true)) {
    isAudioSeeking = false;
    return;
  }
  seekSpeechPercent(Number(audioSeek.value) || 0);
});

document.addEventListener("pointerdown", (event) => {
  const audioSeek = event.target.closest("[data-audio-seek]");
  if (!audioSeek) return;
  const audio = currentGeneratedAudio();
  if (!audio) return;
  isAudioSeeking = true;
  audioWasPlayingBeforeSeek = !audio.paused && !audio.ended;
  if (audioWasPlayingBeforeSeek) audio.pause();
});

document.addEventListener("pointerup", (event) => {
  const audioSeek = event.target.closest("[data-audio-seek]");
  if (!audioSeek || !isAudioSeeking) return;
  seekGeneratedAudioToPercent(Number(audioSeek.value) || 0, true);
  isAudioSeeking = false;
});

document.addEventListener("keyup", (event) => {
  const audioSeek = event.target.closest("[data-audio-seek]");
  if (!audioSeek || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
  seekGeneratedAudioToPercent(Number(audioSeek.value) || 0, true);
});

document.addEventListener("timeupdate", (event) => {
  const audio = event.target.closest?.("[data-generated-audio]");
  if (!audio) return;
  if (!isAudioSeeking) updateGeneratedAudioProgress(audio);
}, true);

document.addEventListener("loadedmetadata", (event) => {
  const audio = event.target.closest?.("[data-generated-audio]");
  if (!audio) return;
  audio.playbackRate = selectedAudioSpeed();
  updateGeneratedAudioProgress(audio);
}, true);

document.addEventListener("ended", (event) => {
  const audio = event.target.closest?.("[data-generated-audio]");
  if (!audio) return;
  updateAudioProgress(100, "100%");
  const nextLink = document.querySelector("[data-audio-next]");
  updateAudioStatus(nextLink ? "Đã nghe hết MP3. Bấm Chương sau để nghe tiếp." : "Đã nghe hết MP3.");
}, true);

document.addEventListener("play", (event) => {
  const audio = event.target.closest?.("[data-generated-audio]");
  if (!audio) return;
  stopSpeech();
  audio.playbackRate = selectedAudioSpeed();
  updateAudioStatus(`Đang phát MP3 Edge ở tốc độ ${selectedAudioSpeed()}x.`);
  startAudioProgressLoop(audio);
}, true);

document.addEventListener("pause", (event) => {
  const audio = event.target.closest?.("[data-generated-audio]");
  if (!audio || audio.ended || isAudioSeeking) return;
  updateAudioStatus("Đã tạm dừng MP3.");
}, true);

els.closeCheckout.addEventListener("click", () => {
  els.modal.hidden = true;
  pendingEmailOtp = null;
});

els.modal.addEventListener("click", (event) => {
  if (event.target === els.modal) {
    els.modal.hidden = true;
    pendingEmailOtp = null;
  }
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
Promise.all([loadStoryCatalog(), initAuth(), loadAudioManifest()])
  .finally(() => route());
