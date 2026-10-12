import type { ProposalTarget } from "./proposals";
import { describe, expect, it } from "vitest";
import { experienceItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	additionAfter,
	applicationOrder,
	applyProposal,
	applyTo,
	collectLetterPassages,
	collectPassages,
	readTarget,
} from "./proposals";

const labels = { body: "Letter", bullet: (n: number) => `bullet ${n}`, paragraph: (n: number) => `paragraph ${n}` };

it("rejects ambiguous paragraphs instead of replacing the first occurrence", () => {
	const value = "<p>Repeated claim.</p><p>Different middle.</p><p>Repeated claim.</p>";
	expect(applyTo(value, { before: "<p>Repeated claim.</p>", after: "<p>Changed</p>" })).toBeUndefined();
	expect(additionAfter(value, "<p>Repeated claim.</p>", "Added")).toBeUndefined();
	expect(applyTo("<p>Unique</p>", { before: "<p>Unique</p>", after: "<p>$&</p>" })).toBe("<p>$&</p>");
});

it("collects and edits nested role descriptions and custom summaries without changing siblings", () => {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		experienceItemSchema.parse({
			id: "company",
			hidden: false,
			company: "Kettle",
			position: "",
			location: "",
			period: "",
			description: "",
			website: { url: "", label: "" },
			roles: [
				{ id: "lead", position: "Lead", period: "", description: "<p>Led delivery.</p>" },
				{ id: "engineer", position: "Engineer", period: "", description: "<p>Built services.</p>" },
			],
		}),
	];
	data.customSections = [
		{
			id: "custom",
			type: "summary",
			title: "About",
			icon: "",
			columns: 1,
			hidden: false,
			keepTogether: false,
			startOnNewPage: false,
			items: [{ id: "about", hidden: false, content: "<p>Custom prose.</p>" }],
		},
	];
	const passages = collectPassages(data, {
		...labels,
		summary: "Summary",
		sectionTitle: (id) => id,
		entryTitle: () => "Kettle",
	});
	expect(passages.map((passage) => passage.text)).toEqual(["Led delivery.", "Built services.", "Custom prose."]);
	for (const passage of [passages[0], passages[2]]) {
		if (!passage) throw new Error("Missing supported passage");
		expect(
			applyProposal(data, {
				id: passage.id,
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: "<p>Revised.</p>",
				why: "Clearer",
				status: "pending",
				source: "check",
			}),
		).toBe(true);
		expect(readTarget(data, passage.target)).toBe("<p>Revised.</p>");
	}
	expect(data.sections.experience.items[0]?.roles[1]?.description).toBe("<p>Built services.</p>");
	expect(data.sections.experience.items[0]?.description).toBe("");
	const experience = data.sections.experience.items[0];
	const custom = data.customSections[0];
	if (!experience || !custom) throw new Error("Missing fixtures");
	experience.hidden = true;
	custom.hidden = true;
	expect(
		collectPassages(data, { ...labels, summary: "Summary", sectionTitle: (id) => id, entryTitle: () => "Kettle" }),
	).toEqual([]);
});

describe("additionAfter", () => {
	it("adds a paragraph after a paragraph, and nothing for a passage that's gone", () => {
		expect(additionAfter("<p>One</p><p>Two</p>", "<p>One</p>", "Between")).toEqual({
			before: "<p>One</p>",
			after: "<p>One</p><p>Between</p>",
		});
		expect(additionAfter("<p>One</p>", "<p>Gone</p>", "x")).toBeUndefined();
	});
});

describe("applicationOrder", () => {
	const target: ProposalTarget = { sectionId: "experience", itemId: "lumen", field: "description" };
	const proposal = (id: string, before: string, after: string, at: ProposalTarget = target) => ({
		id,
		target: at,
		location: id,
		before,
		after,
		why: "",
		status: "pending" as const,
		source: "assistant" as const,
	});

	it("applies an addition before the rewrite of the passage it is anchored on", () => {
		// As resolveEdits places them: the addition carries its anchor in `before`, the rewrite does not.
		const rewrite = proposal("rewrite", "<p>Old</p>", "<p>New</p>");
		const addition = proposal("addition", "<p>Old</p></li>", "<p>Old</p></li><li><p>Extra</p></li>");

		expect(applicationOrder([rewrite, addition]).map((item) => item.id)).toEqual(["addition", "rewrite"]);

		const field = "<ul><li><p>Old</p></li></ul>";
		const value = applicationOrder([rewrite, addition]).reduce((text, item) => applyTo(text, item) ?? text, field);
		expect(value).toBe("<ul><li><p>New</p></li><li><p>Extra</p></li></ul>");
	});

	it("keeps the order of proposals that do not overlap, in the same or another field", () => {
		const first = proposal("first", "<p>One</p>", "<p>One!</p>");
		const second = proposal("second", "<p>Two</p>", "<p>Two!</p>");
		const other = proposal("other", "<p>One</p>", "<p>One!</p>", { sectionId: "summary", field: "content" });

		expect(applicationOrder([first, second, other]).map((item) => item.id)).toEqual(["first", "second", "other"]);
	});

	it("applies an addition first when two proposals share an anchor exactly", () => {
		const rewrite = proposal("rewrite", "<p>Old</p>", "<p>New</p>");
		const addition = proposal("addition", "<p>Old</p>", "<p>Old</p><p>Extra</p>");

		expect(applicationOrder([rewrite, addition]).map((item) => item.id)).toEqual(["addition", "rewrite"]);
	});

	it("does not treat an empty passage's empty before as an anchor held by everything", () => {
		const empty = proposal("empty", "", "<p>Written.</p>", { sectionId: "summary", field: "content" });
		const later = proposal("later", "<p>Old</p>", "<p>New</p>", { sectionId: "summary", field: "content" });

		expect(applicationOrder([empty, later]).map((item) => item.id)).toEqual(["empty", "later"]);
	});
});

describe("collectLetterPassages", () => {
	it("lists the body's paragraphs with stable ids that change with the text", () => {
		const passages = collectLetterPassages("<p>Hello there.</p><p>Hello there.</p><p>Bye.</p>", labels);

		expect(passages.map((passage) => passage.location)).toEqual([
			"Letter · paragraph 1",
			"Letter · paragraph 2",
			"Letter · paragraph 3",
		]);
		expect(passages[1]?.id).toBe(`${passages[0]?.id}_2`);
		expect(collectLetterPassages("<p>Hello, there.</p>", labels)[0]?.id).not.toBe(passages[0]?.id);
	});

	it("offers an empty body as one empty passage only when asked", () => {
		expect(collectLetterPassages("", labels)).toEqual([]);
		const [empty] = collectLetterPassages("", { ...labels, includeEmpty: true });
		expect(empty).toMatchObject({ html: "", text: "", location: "Letter" });
		// Writing into it replaces the empty text.
		expect(applyTo("", { before: "", after: "<p>Dear team</p>" })).toBe("<p>Dear team</p>");
	});
});
