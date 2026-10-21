import { describe, expect, it } from "vitest";
import { createDirectTransportPair } from "./transport";

describe("direct transport pair", () => {
	it("delivers a message from one side to the other", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const received: string[] = [];

		widget.subscribe((message) => received.push(message));
		core.send("hello");

		expect(received).toEqual(["hello"]);
	});

	it("delivers messages in both directions", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const toWidget: string[] = [];
		const toCore: string[] = [];

		widget.subscribe((message) => toWidget.push(message));
		core.subscribe((message) => toCore.push(message));

		core.send("to-widget");
		widget.send("to-core");

		expect(toWidget).toEqual(["to-widget"]);
		expect(toCore).toEqual(["to-core"]);
	});

	it("delivers the same message to every subscriber", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const first: string[] = [];
		const second: string[] = [];

		widget.subscribe((message) => first.push(message));
		widget.subscribe((message) => second.push(message));

		core.send("broadcast");

		expect(first).toEqual(["broadcast"]);
		expect(second).toEqual(["broadcast"]);
	});

	it("preserves the order of messages", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const received: string[] = [];

		widget.subscribe((message) => received.push(message));

		core.send("one");
		core.send("two");
		core.send("three");

		expect(received).toEqual(["one", "two", "three"]);
	});

	it("unsubscribe stops the delivery", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const received: string[] = [];

		const unsubscribe = widget.subscribe((message) => received.push(message));

		core.send("before");
		unsubscribe();
		core.send("after");

		expect(received).toEqual(["before"]);
	});

	it("dispose tears the pair down", () => {
		const [core, widget] = createDirectTransportPair<string, string>();
		const received: string[] = [];

		widget.subscribe((message) => received.push(message));

		core.dispose();
		core.send("after-dispose");

		expect(received).toEqual([]);
	});

	it("does not throw when sending after dispose", () => {
		const [core] = createDirectTransportPair<string, string>();

		core.dispose();

		expect(() => core.send("late")).not.toThrow();
	});
});
