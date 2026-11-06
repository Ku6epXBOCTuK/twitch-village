import {
	PROTOCOL_VERSION,
	createDirectTransportPair,
	type CoreToWidget,
	type LeafCommand,
	type ViewerId,
	type WidgetId,
	type WidgetToCore,
} from "@tv/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { createShootingWordsWidget, type ShootingWordsWidget } from "./widget";

const widgetId = "shooting-words" as WidgetId;
const viewerId = "viewer-1" as ViewerId;

const setup = (): {
	widget: ShootingWordsWidget;
	messages: WidgetToCore["message"][];
	send: (message: CoreToWidget["message"]) => void;
	commands: () => LeafCommand[];
	clear: () => void;
} => {
	const [coreSide, widgetSide] = createDirectTransportPair<
		CoreToWidget,
		WidgetToCore
	>();
	const widget = createShootingWordsWidget(widgetSide, {
		tickMs: 0,
		heartbeatMs: 0,
		seed: 42,
	});
	const messages: WidgetToCore["message"][] = [];
	coreSide.subscribe((envelope) => {
		messages.push(envelope.message);
	});
	const send = (message: CoreToWidget["message"]): void => {
		coreSide.send({ protocolVersion: PROTOCOL_VERSION, message });
	};
	const commands = (): LeafCommand[] =>
		messages.flatMap((message) =>
			message._tag === "Batch" ? message.commands : [],
		);
	const clear = (): void => {
		messages.length = 0;
	};
	send({
		_tag: "Init",
		widgetId,
		config: {},
		viewport: { w: 1280, h: 720 },
	});
	return { widget, messages, send, commands, clear };
};

describe("shooting words widget", () => {
	let harness: ReturnType<typeof setup>;

	beforeEach(() => {
		harness = setup();
	});

	it("sends Ready before any scene command", () => {
		expect(harness.messages[0]).toEqual({
			_tag: "Ready",
			widgetId,
			protocolVersion: PROTOCOL_VERSION,
		});
	});

	it("creates the scene on init", () => {
		const create = harness
			.commands()
			.find(
				(command) =>
					command._tag === "CreateNode" && command.nodeId === "sw-scene",
			);
		expect(create).toMatchObject({ kind: "container" });
	});

	it("creates a ship with label, hp bar and animation on join", () => {
		harness.clear();
		harness.send({
			_tag: "ViewerEvent",
			event: {
				_tag: "ViewerJoined",
				viewerId,
				displayName: "Mira",
				color: "#60a5fa",
			},
		});
		const commands = harness.commands();
		expect(
			commands.some(
				(command) =>
					command._tag === "CreateNode" && command.nodeId === "sw-ship-1",
			),
		).toBe(true);
		expect(
			commands.some(
				(command) =>
					command._tag === "CreateNode" &&
					command.nodeId === "sw-ship-1-sprite",
			),
		).toBe(true);
		expect(
			commands.some(
				(command) =>
					command._tag === "SetAnimation" &&
					command.nodeId === "sw-ship-1-sprite",
			),
		).toBe(true);
	});

	it("spawns a word and shoots it on a matching message", () => {
		harness.widget.tick(4000);
		const word = harness.widget.world?.words.values().next().value;
		expect(word).toBeDefined();
		if (word === undefined) return;

		harness.send({
			_tag: "ViewerEvent",
			event: {
				_tag: "ViewerJoined",
				viewerId,
				displayName: "Mira",
				color: "#60a5fa",
			},
		});
		harness.clear();
		harness.send({
			_tag: "ViewerEvent",
			event: {
				_tag: "ViewerMessage",
				viewerId,
				login: "mira",
				text: word.text,
				isCommand: false,
				isMod: false,
			},
		});

		expect(
			harness
				.commands()
				.some(
					(command) =>
						command._tag === "CreateNode" && command.nodeId === "sw-bullet-1",
				),
		).toBe(true);
	});

	it("does not emit anything while paused", () => {
		harness.send({ _tag: "Pause" });
		harness.clear();
		harness.widget.tick(4000);
		expect(harness.messages).toEqual([]);
	});

	it("removes the ship node when the viewer leaves", () => {
		harness.send({
			_tag: "ViewerEvent",
			event: {
				_tag: "ViewerJoined",
				viewerId,
				displayName: "Mira",
				color: "#60a5fa",
			},
		});
		harness.clear();
		harness.send({
			_tag: "ViewerEvent",
			event: { _tag: "ViewerLeft", viewerId },
		});
		expect(harness.commands()).toEqual([
			{ _tag: "RemoveNode", nodeId: "sw-ship-1" },
		]);
	});

	it("resizes the world on viewport change", () => {
		harness.send({ _tag: "Viewport", w: 800, h: 600 });
		expect(harness.widget.world?.width).toBe(800);
		expect(harness.widget.world?.height).toBe(600);
	});

	it("removes the scene on dispose", () => {
		harness.clear();
		harness.send({ _tag: "Dispose" });
		expect(harness.commands()).toContainEqual({
			_tag: "RemoveNode",
			nodeId: "sw-scene",
		});
	});
});
