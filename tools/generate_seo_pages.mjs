import fs from "node:fs/promises";
import path from "node:path";

const siteConfig = JSON.parse(await fs.readFile(path.resolve("tools/site-config.json"), "utf8"));
const SITE_URL = siteConfig.siteUrl.replace(/\/$/, "");
const STORY_SEO_BASE_PATH = (siteConfig.storySeoBasePath || "/truyen").replace(/^\/?/, "/").replace(/\/$/, "");
const SUPABASE_URL = "https://lgjkyclvpzijvjepmncq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NQ-pBBYLNskZctSbYYPyfA_pQznXUYh";
const OUT_DIR = path.resolve("doc-truyen-vip");
const EXCERPT_PARAGRAPHS = 8;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value = "") {
  return escapeHtml(value);
}

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function metaDescription(value, limit = 155) {
  const text = stripHtml(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
}

function jsonLd(data) {
  return JSON.stringify(data).replaceAll("</", "<\\/");
}

async function supabaseRpc(name, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${name} failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function loadBundledStories() {
  try {
    const source = await fs.readFile(path.join(OUT_DIR, "extra-stories.js"), "utf8");
    const stories = [];
    const pattern = /window\.STORY_DATA\.stories\.push\(([\s\S]*?)\);\s*/g;
    for (const match of source.matchAll(pattern)) {
      stories.push(JSON.parse(match[1]));
    }
    return stories;
  } catch {
    return [];
  }
}

function pageShell({ title, description, canonical, body, schema, stylesheet }) {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-snippet:-1" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="${escapeHtml(stylesheet)}" />
    <script type="application/ld+json">${jsonLd(schema)}</script>
  </head>
  <body>
    <main class="seo-page">
      ${body}
    </main>
  </body>
</html>
`;
}

function chapterUrl(storyId, chapterId) {
  return `${SITE_URL}${STORY_SEO_BASE_PATH}/${storyId}/chuong/${chapterId}/`;
}

function appReadUrl(storyId, chapterId) {
  return `${SITE_URL}/#/read/${storyId}/${chapterId}`;
}

function appStoryUrl(storyId) {
  return `${SITE_URL}/#/story/${storyId}`;
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function removeOldSeoPages() {
  await fs.rm(path.join(OUT_DIR, STORY_SEO_BASE_PATH.replace(/^\//, "")), { recursive: true, force: true });
}

async function build() {
  const catalog = await supabaseRpc("get_story_catalog");
  const remoteStories = Array.isArray(catalog) ? catalog : (catalog.stories || []);
  const bundledStories = await loadBundledStories();
  const remoteIds = new Set(remoteStories.map((story) => story.id));
  const stories = [
    ...remoteStories,
    ...bundledStories.filter((story) => !remoteIds.has(story.id))
  ];
  const sitemapUrls = [
    { loc: `${SITE_URL}/`, priority: "1.0", changefreq: "daily" }
  ];

  await removeOldSeoPages();

  for (const story of stories) {
    const storyId = story.id;
    const storyDir = path.join(OUT_DIR, STORY_SEO_BASE_PATH.replace(/^\//, ""), storyId);
    const storyCanonical = `${SITE_URL}${STORY_SEO_BASE_PATH}/${storyId}/`;
    const storyDescription = metaDescription(`${story.title}. ${story.summary || ""} Đọc truyện mạt thế phế thổ tiếng Việt có audio tại Truyện 2K.`);
    const chapters = Array.isArray(story.chapters) ? story.chapters : [];
    const firstChapter = chapters[0];
    const chapterLinks = chapters.map((chapter) => `
          <li>
            <a href="./chuong/${chapter.id}/">${escapeHtml(chapter.title)}</a>
            <a class="seo-small-link" href="${escapeHtml(appReadUrl(storyId, chapter.id))}">Đọc ngay</a>
          </li>`).join("");

    const storySchema = {
      "@context": "https://schema.org",
      "@type": "Book",
      name: story.title,
      author: { "@type": "Person", name: story.author || "ThanhMV" },
      inLanguage: "vi",
      genre: story.genre || [],
      url: storyCanonical,
      description: story.summary || storyDescription,
      numberOfPages: chapters.length,
      isAccessibleForFree: true
    };

    await writeFile(path.join(storyDir, "index.html"), pageShell({
      title: `${story.title} - Đọc truyện phế thổ miễn phí | Truyện 2K`,
      description: storyDescription,
      canonical: storyCanonical,
      stylesheet: "../../styles.css",
      schema: storySchema,
      body: `
        <nav class="seo-breadcrumb"><a href="${SITE_URL}/">Truyện 2K</a> / ${escapeHtml(story.title)}</nav>
        <header class="seo-hero">
          <span class="eyebrow">Truyện mạt thế phế thổ</span>
          <h1>${escapeHtml(story.title)}</h1>
          <p>${escapeHtml(story.summary || "")}</p>
          <div class="seo-actions">
            <a class="btn btn-primary" href="${escapeHtml(firstChapter ? appReadUrl(storyId, firstChapter.id) : appStoryUrl(storyId))}">Đọc truyện</a>
            <a class="btn btn-secondary" href="${escapeHtml(appStoryUrl(storyId))}">Mở thư viện</a>
          </div>
        </header>
        <section class="panel">
          <h2>Danh sách chương</h2>
          <ol class="seo-chapter-list">${chapterLinks}</ol>
        </section>`
    }));
    sitemapUrls.push({ loc: storyCanonical, priority: "0.9", changefreq: "daily" });

    for (const chapter of chapters) {
      let body = Array.isArray(chapter.body) ? chapter.body : [];
      if (!body.length) {
        const chapterData = await supabaseRpc("get_chapter_for_reader", {
          p_story_id: storyId,
          p_chapter_id: chapter.id
        });
        body = Array.isArray(chapterData.body) ? chapterData.body : [];
      }
      const excerpt = body.slice(0, EXCERPT_PARAGRAPHS);
      const canonical = chapterUrl(storyId, chapter.id);
      const description = metaDescription(`${chapter.title}. ${excerpt.join(" ") || story.summary || ""}`);
      const schema = {
        "@context": "https://schema.org",
        "@type": "Chapter",
        name: chapter.title,
        isPartOf: {
          "@type": "Book",
          name: story.title,
          url: storyCanonical
        },
        author: { "@type": "Person", name: story.author || "ThanhMV" },
        inLanguage: "vi",
        url: canonical,
        isAccessibleForFree: chapter.free !== false
      };

      await writeFile(path.join(storyDir, "chuong", chapter.id, "index.html"), pageShell({
        title: `${chapter.title} - ${story.title} | Truyện 2K`,
        description,
        canonical,
        stylesheet: "../../../../styles.css",
        schema,
        body: `
          <nav class="seo-breadcrumb"><a href="${SITE_URL}/">Truyện 2K</a> / <a href="../../">${escapeHtml(story.title)}</a></nav>
          <article class="seo-reader">
            <header>
              <span class="eyebrow">Chương truyện</span>
              <h1>${escapeHtml(chapter.title)}</h1>
              <p class="muted">${escapeHtml(story.title)} · đọc và nghe miễn phí</p>
              <div class="seo-actions">
                <a class="btn btn-primary" href="${escapeHtml(appReadUrl(storyId, chapter.id))}">Đọc đầy đủ trong app</a>
                <a class="btn btn-secondary" href="../">Danh sách chương</a>
              </div>
            </header>
            <section class="reader-content seo-excerpt">
              ${excerpt.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
            </section>
          </article>`
      }));
      sitemapUrls.push({ loc: canonical, priority: "0.7", changefreq: "weekly" });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
  await writeFile(path.join(OUT_DIR, "sitemap.xml"), sitemap);
  await writeFile(path.join(OUT_DIR, "robots.txt"), `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`);
  console.log(`Generated ${sitemapUrls.length} SEO URLs.`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
