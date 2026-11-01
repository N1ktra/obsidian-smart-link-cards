import { describe, expect, it } from "vitest";

// Lightweight DOM mock for testing readingMode logic in Node environment
class MockNode {
	static TEXT_NODE = 3;
	static ELEMENT_NODE = 1;

	nodeType: number;
	textContent: string | null;
	previousSibling: MockNode | null = null;
	nextSibling: MockNode | null = null;
	parentElement: MockElement | null = null;

	constructor(type: number, text: string | null = null) {
		this.nodeType = type;
		this.textContent = text;
	}
}

class MockElement extends MockNode {
	tagName: string;
	nodeName: string;
	classList = {
		contains: (cls: string) => this.classes.has(cls),
		add: (cls: string) => this.classes.add(cls),
	};
	private classes = new Set<string>();

	constructor(tagName: string, cls: string = "") {
		super(MockNode.ELEMENT_NODE, "");
		this.tagName = tagName.toUpperCase();
		this.nodeName = tagName.toUpperCase();
		if (cls) cls.split(/\s+/).forEach((c) => this.classes.add(c));
	}

	closest(selector: string): MockElement | null {
		return null;
	}

	querySelector(selector: string): MockElement | null {
		return null;
	}
}

// Install globals for the test module
(globalThis as any).Node = MockNode;
(globalThis as any).HTMLElement = MockElement;

import { isStandaloneAnchor } from "../src/readingMode";

describe("isStandaloneAnchor", () => {
	it("classifies standalone link between newlines as block", () => {
		const parent = new MockElement("P");
		const a1 = new MockElement("A", "external-link");
		a1.parentElement = parent;

		const newlineAfter = new MockNode(MockNode.TEXT_NODE, "\n");
		a1.nextSibling = newlineAfter;

		expect(isStandaloneAnchor(a1 as unknown as HTMLElement)).toBe(true);
	});

	it("classifies link with preceding text on the same line as inline", () => {
		const parent = new MockElement("P");
		const newlineAndText = new MockNode(MockNode.TEXT_NODE, "\na ");
		const a2 = new MockElement("A", "external-link");
		
		newlineAndText.parentElement = parent;
		a2.parentElement = parent;
		a2.previousSibling = newlineAndText;

		expect(isStandaloneAnchor(a2 as unknown as HTMLElement)).toBe(false);
	});

	it("classifies standalone link directly after card as block", () => {
		const parent = new MockElement("P");
		const card = new MockElement("DIV", "slc-card");
		const a2 = new MockElement("A", "external-link");

		card.parentElement = parent;
		a2.parentElement = parent;
		a2.previousSibling = card;

		expect(isStandaloneAnchor(a2 as unknown as HTMLElement)).toBe(true);
	});
});
