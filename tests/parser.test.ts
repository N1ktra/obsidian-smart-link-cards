import { describe, expect, it } from "vitest";
import {
	classifyLine,
	findInlineCodeRanges,
	findLinksInLine,
	getStandaloneLink,
	isStandaloneListLink,
	normalizeUrl,
	parseDocument,
	parseIcon,
	parseTitleOverrides,
} from "../src/parser";

describe("findLinksInLine", () => {
	it("finds a bare URL", () => {
		const [link] = findLinksInLine("https://github.com");
		expect(link).toMatchObject({ from: 0, to: 18, url: "https://github.com", syntax: "bare" });
	});

	it("finds a markdown link with text as title override", () => {
		const line = "[GitHub](https://github.com)";
		const [link] = findLinksInLine(line);
		expect(link).toMatchObject({
			from: 0,
			to: line.length,
			url: "https://github.com",
			syntax: "markdown",
			overrides: { title: "GitHub" },
		});
	});

	it("finds autolinks", () => {
		const [link] = findLinksInLine("see <https://example.com/a>");
		expect(link).toMatchObject({ url: "https://example.com/a", syntax: "autolink", from: 4, to: 27 });
	});

	it("strips trailing punctuation from bare URLs", () => {
		const links = findLinksInLine("Visit https://example.com/page. Or (https://example.org)!");
		expect(links.map((l) => l.url)).toEqual(["https://example.com/page", "https://example.org"]);
	});

	it("keeps balanced parentheses in URLs", () => {
		const [bare] = findLinksInLine("https://en.wikipedia.org/wiki/Foo_(bar)");
		expect(bare.url).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
		const [md] = findLinksInLine("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))");
		expect(md.url).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
	});

	it("ignores links inside inline code", () => {
		expect(findLinksInLine("`https://example.com`")).toEqual([]);
		expect(findLinksInLine("``[x](https://example.com)``")).toEqual([]);
		const links = findLinksInLine("`code` and https://example.com");
		expect(links).toHaveLength(1);
		expect(links[0].from).toBe(11);
	});

	it("ignores images, badges, wiki links and non-web links", () => {
		expect(findLinksInLine("![alt](https://example.com/img.png)")).toEqual([]);
		expect(findLinksInLine("[![badge](https://img.shields.io/x)](https://example.com)")).toEqual([]);
		expect(findLinksInLine("[[Some note]]")).toEqual([]);
		expect(findLinksInLine("[mail](mailto:a@b.c) [note](Other%20note.md)")).toEqual([]);
	});

	it("ignores URLs inside HTML attributes", () => {
		expect(findLinksInLine('<a href="https://example.com">x</a>')).toEqual([]);
	});

	it("does not treat escaped brackets as links", () => {
		const links = findLinksInLine("\\[x](https://example.com)");
		// The escaped "[" is literal; the URL is not bare either (preceded by "(").
		expect(links.every((l) => l.syntax !== "markdown")).toBe(true);
	});

	it("finds multiple links in running text", () => {
		const links = findLinksInLine("A [one](https://one.com) and https://two.com end");
		expect(links.map((l) => l.url)).toEqual(["https://one.com", "https://two.com"]);
	});
});

describe("block vs inline classification", () => {
	it("treats a lone bare URL as block", () => {
		expect(classifyLine("https://github.com")[0].mode).toBe("block");
		expect(classifyLine("  https://github.com  ")[0].mode).toBe("block");
	});

	it("treats a lone markdown link as block", () => {
		expect(classifyLine("[GitHub](https://github.com)")[0].mode).toBe("block");
	});

	it("treats links in quotes on their own line as block", () => {
		expect(classifyLine("> https://github.com")[0].mode).toBe("block");
		expect(classifyLine("> [GitHub](https://github.com)")[0].mode).toBe("block");
		expect(classifyLine(">> https://github.com")[0].mode).toBe("block");
	});

	it("treats links in text, lists, headings and tables as inline", () => {
		expect(classifyLine("Look at https://github.com")[0].mode).toBe("inline");
		expect(classifyLine("https://github.com is great")[0].mode).toBe("inline");
		expect(classifyLine("- https://github.com")[0].mode).toBe("inline");
		expect(classifyLine("1. [x](https://github.com)")[0].mode).toBe("inline");
		expect(classifyLine("> text https://github.com")[0].mode).toBe("inline");
		expect(classifyLine("# [x](https://github.com)")[0].mode).toBe("inline");
		expect(classifyLine("| https://github.com | b |")[0].mode).toBe("inline");
	});

	it("treats two links on one line as inline", () => {
		const modes = classifyLine("https://a.com https://b.com").map((l) => l.mode);
		expect(modes).toEqual(["inline", "inline"]);
	});

	it("does not treat indented (code) lines as block", () => {
		expect(getStandaloneLink("    https://github.com")).toBeNull();
	});
});

describe("isStandaloneListLink", () => {
	it("identifies standalone links in bullet lists", () => {
		const line = "- https://github.com";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(true);
	});

	it("identifies standalone links in nested bullet lists", () => {
		const line = "  - https://github.com";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(true);
	});

	it("identifies standalone links with markdown syntax in lists", () => {
		const line = "  * [GitHub](https://github.com)";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(true);
	});

	it("identifies standalone links in numbered lists", () => {
		const line = "1. https://github.com";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(true);
	});

	it("identifies standalone links in task lists", () => {
		const unchecked = "- [ ] https://github.com";
		const [link1] = findLinksInLine(unchecked);
		expect(isStandaloneListLink(unchecked, link1)).toBe(true);

		const checked = "- [x] [GitHub](https://github.com)";
		const [link2] = findLinksInLine(checked);
		expect(isStandaloneListLink(checked, link2)).toBe(true);
	});

	it("returns false if there is text before the link", () => {
		const line = "- Visuals: https://github.com";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(false);

		const longLine = "- (Selbstgemachter) Spiegel der leuchtet (led streifen um den Rand) [Herding](https://example.com)";
		const [linkLong] = findLinksInLine(longLine);
		expect(isStandaloneListLink(longLine, linkLong)).toBe(false);
	});

	it("returns false if there is text after the link", () => {
		const line = "- https://github.com (docs)";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(false);
	});

	it("returns false for non-list lines", () => {
		const line = "https://github.com";
		const [link] = findLinksInLine(line);
		expect(isStandaloneListLink(line, link)).toBe(false);
	});
});

describe("title attribute overrides", () => {
	it("uses the whole title as description without a pipe", () => {
		expect(parseTitleOverrides("My university portal")).toEqual({ description: "My university portal" });
	});

	it("splits description and emoji icon at the pipe", () => {
		expect(parseTitleOverrides("Uni portal | 🎓")).toEqual({
			description: "Uni portal",
			icon: { type: "emoji", value: "🎓" },
		});
	});

	it("splits description and URL icon at the pipe", () => {
		expect(parseTitleOverrides("Portal | https://uni.example/icon.png")).toEqual({
			description: "Portal",
			icon: { type: "url", value: "https://uni.example/icon.png" },
		});
	});

	it("splits description and vault image icon at the pipe", () => {
		expect(parseTitleOverrides("Portal | [[Bild.jpg]]")).toEqual({
			description: "Portal",
			icon: { type: "vault", value: "Bild.jpg" },
		});
		expect(parseTitleOverrides("Portal | ![[attachments/Bild.png|100]]")).toEqual({
			description: "Portal",
			icon: { type: "vault", value: "attachments/Bild.png" },
		});
	});

	it("supports a vault image icon without description", () => {
		expect(parseTitleOverrides("[[Bild.jpg]]")).toEqual({
			icon: { type: "vault", value: "Bild.jpg" },
		});
		expect(parseTitleOverrides("![[Bild.jpg|alias]]")).toEqual({
			icon: { type: "vault", value: "Bild.jpg" },
		});
		expect(parseTitleOverrides("| [[Bild.jpg]]")).toEqual({
			icon: { type: "vault", value: "Bild.jpg" },
		});
	});

	it("supports an icon without description", () => {
		expect(parseTitleOverrides("| 🎓")).toEqual({ icon: { type: "emoji", value: "🎓" } });
	});

	it("falls back to plain description if the part after the pipe is not an icon", () => {
		expect(parseTitleOverrides("Foo | some longer text")).toEqual({ description: "Foo | some longer text" });
	});

	it("returns nothing for empty titles", () => {
		expect(parseTitleOverrides(undefined)).toEqual({});
		expect(parseTitleOverrides("   ")).toEqual({});
	});

	it("classifies icons", () => {
		expect(parseIcon("🎓")).toEqual({ type: "emoji", value: "🎓" });
		expect(parseIcon("👨‍👩‍👧")).toEqual({ type: "emoji", value: "👨‍👩‍👧" });
		expect(parseIcon("https://x.y/i.svg")).toEqual({ type: "url", value: "https://x.y/i.svg" });
		expect(parseIcon("data:image/png;base64,AAA")?.type).toBe("url");
		expect(parseIcon("[[Bild.jpg]]")).toEqual({ type: "vault", value: "Bild.jpg" });
		expect(parseIcon("![[assets/logo.svg|200]]")).toEqual({ type: "vault", value: "assets/logo.svg" });
		expect(parseIcon("my-logo.png")).toEqual({ type: "vault", value: "my-logo.png" });
		expect(parseIcon("")).toBeUndefined();
	});

	it("parses overrides from the full markdown link", () => {
		const [link] = findLinksInLine('[Moodle](https://moodle.uni.de "Kursportal | 🎓")');
		expect(link.overrides).toEqual({
			title: "Moodle",
			description: "Kursportal",
			icon: { type: "emoji", value: "🎓" },
		});
		expect(link.rawTitle).toBe("Kursportal | 🎓");

		const [vaultLink] = findLinksInLine('[Moodle](https://moodle.uni.de "Kursportal | [[Bild.jpg]]")');
		expect(vaultLink.overrides).toEqual({
			title: "Moodle",
			description: "Kursportal",
			icon: { type: "vault", value: "Bild.jpg" },
		});
	});

	it("supports single-quoted, parenthesised and escaped titles", () => {
		expect(findLinksInLine("[a](https://a.com 'Desc')")[0].overrides.description).toBe("Desc");
		expect(findLinksInLine("[a](https://a.com (Desc))")[0].overrides.description).toBe("Desc");
		expect(findLinksInLine('[a](https://a.com "Say \\"hi\\"")')[0].overrides.description).toBe('Say "hi"');
	});

	it("supports angle-bracket destinations", () => {
		const [link] = findLinksInLine('[a](<https://a.com/x y> "D | 🎓")');
		expect(link.url).toBe("https://a.com/x y");
		expect(link.overrides.icon).toEqual({ type: "emoji", value: "🎓" });
	});

	it("does not set a title override when the link text equals the URL", () => {
		const [link] = findLinksInLine("[https://a.com](https://a.com)");
		expect(link.overrides.title).toBeUndefined();
	});

	it("strips inline formatting from link text", () => {
		const [link] = findLinksInLine("[**Bold** `code`](https://a.com)");
		expect(link.overrides.title).toBe("Bold code");
	});
});

describe("parseDocument", () => {
	it("skips fenced code blocks (``` and ~~~)", () => {
		const doc = [
			"https://visible.com",
			"```",
			"https://hidden-in-code.com",
			"```",
			"~~~~js",
			"[x](https://hidden2.com)",
			"~~~",
			"still code https://hidden3.com",
			"~~~~",
			"text https://visible2.com",
		].join("\n");
		const links = parseDocument(doc);
		expect(links.map((l) => l.url)).toEqual(["https://visible.com", "https://visible2.com"]);
		expect(links.map((l) => l.mode)).toEqual(["block", "inline"]);
	});

	it("skips frontmatter and math blocks", () => {
		const doc = ["---", "source: https://front.com", "---", "$$", "https://math.com", "$$", "https://ok.com"].join("\n");
		expect(parseDocument(doc).map((l) => l.url)).toEqual(["https://ok.com"]);
	});

	it("reports absolute offsets and line numbers", () => {
		const doc = "line one\r\nsee https://a.com";
		const [link] = parseDocument(doc);
		expect(link.line).toBe(1);
		expect(doc.slice(link.absFrom, link.absTo)).toBe("https://a.com");
	});
});

describe("helpers", () => {
	it("finds inline code ranges", () => {
		expect(findInlineCodeRanges("a `b` c ``d`e`` f")).toEqual([
			[2, 5],
			[8, 15],
		]);
		expect(findInlineCodeRanges("unclosed ` tick")).toEqual([]);
	});

	it("normalizes URLs for cache keys", () => {
		expect(normalizeUrl("  https://a.com/x#section ")).toBe("https://a.com/x");
	});
});
