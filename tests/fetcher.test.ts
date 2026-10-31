import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { decodeHtmlEntities, fetchLinkMetadata, parseHtmlMetadata } from "../src/fetcher";

const mockedRequestUrl = vi.mocked(requestUrl);

function response(status: number, text: string, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) {
	return { status, text, headers, arrayBuffer: new ArrayBuffer(0), json: null } as unknown as Awaited<ReturnType<typeof requestUrl>>;
}

const OG_HTML = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>Fallback Title</title>
  <meta property="og:title" content="GitHub &amp; Friends">
  <meta content="Where the world builds software" property="og:description" />
  <meta name="description" content="Plain description">
  <link rel="apple-touch-icon" href="/apple.png">
  <link rel="shortcut icon" href="/favicon.ico">
</head><body><meta property="og:title" content="Body title must be ignored"></body></html>`;

describe("parseHtmlMetadata", () => {
	it("prefers OpenGraph tags (attribute order independent)", () => {
		expect(parseHtmlMetadata(OG_HTML, "https://github.com/some/page")).toEqual({
			title: "GitHub & Friends",
			description: "Where the world builds software",
			faviconUrl: "https://github.com/favicon.ico",
		});
	});

	it("falls back to <title> and meta description", () => {
		const html = `<html><head><title>
		   Hello   World </title><meta name="Description" content='Desc &#8211; ok'></head></html>`;
		expect(parseHtmlMetadata(html, "https://x.com")).toEqual({
			title: "Hello World",
			description: "Desc – ok",
		});
	});

	it("uses apple-touch-icon when no regular icon exists", () => {
		const html = `<head><link href="https://cdn.x.com/a.png" rel="apple-touch-icon"></head>`;
		expect(parseHtmlMetadata(html, "https://x.com").faviconUrl).toBe("https://cdn.x.com/a.png");
	});

	it("extracts OpenGraph and Twitter images as imageUrl", () => {
		const ogHtml = `<head><meta property="og:image" content="/assets/cover.jpg"></head>`;
		expect(parseHtmlMetadata(ogHtml, "https://blog.example.com/post").imageUrl).toBe(
			"https://blog.example.com/assets/cover.jpg",
		);

		const twitterHtml = `<head><meta name="twitter:image" content="https://cdn.example.com/banner.png"></head>`;
		expect(parseHtmlMetadata(twitterHtml, "https://example.com").imageUrl).toBe(
			"https://cdn.example.com/banner.png",
		);
	});

	it("extracts Amazon product image from landingImage tag or script data", () => {
		const amazonHtml = `
			<html>
			<head><title>Morvexa Teigschüssel</title></head>
			<body>
				<img id="landingImage" src="https://m.media-amazon.com/images/I/low.jpg" data-old-hires="https://m.media-amazon.com/images/I/hires.jpg" />
			</body>
			</html>
		`;
		expect(parseHtmlMetadata(amazonHtml, "https://www.amazon.de/dp/B0GYXQHY3K").imageUrl).toBe(
			"https://m.media-amazon.com/images/I/hires.jpg",
		);

		const amazonDynamicHtml = `
			<html>
			<head><title>Product</title></head>
			<body>
				<img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/dynamic.jpg&quot;:[355,355]}" />
			</body>
			</html>
		`;
		expect(parseHtmlMetadata(amazonDynamicHtml, "https://www.amazon.de/dp/B0GYXQHY3K").imageUrl).toBe(
			"https://m.media-amazon.com/images/I/dynamic.jpg",
		);
	});

	it("extracts images from JSON-LD Schema (Yoast @graph, thumbnailUrl, etc.)", () => {
		const yoastHtml = `
			<html>
			<head>
				<script type="application/ld+json">
					{"@context":"https://schema.org","@graph":[{"@type":"CollectionPage","thumbnailUrl":"https://example.com/thumb.jpg"}]}
				</script>
			</head>
			</html>
		`;
		expect(parseHtmlMetadata(yoastHtml, "https://example.com").imageUrl).toBe("https://example.com/thumb.jpg");

		const productJsonLd = `
			<html>
			<head>
				<script type="application/ld+json">
					{"@context":"https://schema.org/","@type":"Product","image":["https://cdn.example.com/product.png"]}
				</script>
			</head>
			</html>
		`;
		expect(parseHtmlMetadata(productJsonLd, "https://example.com").imageUrl).toBe("https://cdn.example.com/product.png");
	});

	it("extracts WordPress featured image and tile image fallback", () => {
		const wpHtml = `
			<html><body>
				<img src="/uploads/cover.jpg" class="attachment-post-thumbnail size-post-thumbnail wp-post-image" />
			</body></html>
		`;
		expect(parseHtmlMetadata(wpHtml, "https://blog.com").imageUrl).toBe("https://blog.com/uploads/cover.jpg");

		const tileHtml = `
			<html><head>
				<meta name="msapplication-TileImage" content="https://site.com/tile.png" />
			</head></html>
		`;
		expect(parseHtmlMetadata(tileHtml, "https://site.com").imageUrl).toBe("https://site.com/tile.png");
	});

	it("extracts embedded YouTube video thumbnail, video poster, and content images", () => {
		const ytEmbedHtml = `
			<html><body>
				<h1>Research Project</h1>
				<iframe width="800" height="450" src="https://www.youtube.com/embed/KyvutGnzLxI?autoplay=1"></iframe>
				<img src="figures/method.png" />
			</body></html>
		`;
		expect(parseHtmlMetadata(ytEmbedHtml, "https://research.site.com/project/").imageUrl).toBe(
			"https://img.youtube.com/vi/KyvutGnzLxI/hqdefault.jpg",
		);

		const posterHtml = `
			<html><body>
				<video width="100%" poster="/media/hero.jpg" autoplay loop></video>
			</body></html>
		`;
		expect(parseHtmlMetadata(posterHtml, "https://site.com").imageUrl).toBe("https://site.com/media/hero.jpg");

		const contentHtml = `
			<html><body>
				<nav><img src="/logo.svg" width="120" /></nav>
				<main>
					<img src="/avatar.png" class="user-avatar" width="32" height="32" />
					<img src="/assets/teaser.webp" width="800" />
				</main>
			</body></html>
		`;
		expect(parseHtmlMetadata(contentHtml, "https://portfolio.com").imageUrl).toBe("https://portfolio.com/assets/teaser.webp");
	});

	it("returns an empty object for HTML without metadata", () => {
		expect(parseHtmlMetadata("<html><body>nothing</body></html>", "https://x.com")).toEqual({});
	});

	it("truncates overly long descriptions", () => {
		const long = "a".repeat(1000);
		const html = `<head><meta name="description" content="${long}"></head>`;
		const description = parseHtmlMetadata(html, "https://x.com").description as string;
		expect(description.length).toBeLessThanOrEqual(300);
		expect(description.endsWith("…")).toBe(true);
	});

	it("decodes entities", () => {
		expect(decodeHtmlEntities("&lt;a&gt; &quot;b&quot; &#x1F393; &uuml;")).toBe('<a> "b" 🎓 ü');
	});
});

describe("fetchLinkMetadata", () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it("uses requestUrl() (never fetch) and extracts metadata", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		mockedRequestUrl.mockResolvedValue(response(200, OG_HTML));

		const result = await fetchLinkMetadata("https://github.com", 1234);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(mockedRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://github.com", method: "GET", throw: false }),
		);
		expect(result).toEqual({
			ok: true,
			metadata: {
				title: "GitHub & Friends",
				description: "Where the world builds software",
				faviconUrl: "https://github.com/favicon.ico",
				fetchedAt: 1234,
			},
		});
		vi.unstubAllGlobals();
	});

	it("reports HTTP errors as failures", async () => {
		mockedRequestUrl.mockResolvedValue(response(403, "Forbidden"));
		expect(await fetchLinkMetadata("https://uni.example")).toEqual({ ok: false, status: 403, error: "HTTP 403" });
	});

	it("never throws on network errors", async () => {
		mockedRequestUrl.mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED"));
		expect(await fetchLinkMetadata("https://nope.invalid")).toEqual({
			ok: false,
			error: "net::ERR_NAME_NOT_RESOLVED",
		});
	});

	it("returns an empty (but cacheable) entry for non-HTML resources", async () => {
		mockedRequestUrl.mockResolvedValue(response(200, "%PDF", { "Content-Type": "application/pdf" }));
		expect(await fetchLinkMetadata("https://x.com/a.pdf", 99)).toEqual({ ok: true, metadata: { fetchedAt: 99 } });
	});
});
