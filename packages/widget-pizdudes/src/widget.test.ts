import {
	type CoreToWidget,
	PROTOCOL_VERSION,
	type ViewerEvent,
	type ViewerId,
	type WidgetId,
	type WidgetToCore,
	createDirectTransportPair,
} from "@tv/protocol";
import { describe, expect, it } from "vitest";
import { COOK_FPS, STATION_NAMES, cookFrames } from "./assets";
import { directionFromVelocity } from "./world";
import { createPizdudesWidget } from "./widget";

const widgetId = "pizdudes" as WidgetId;
const viewerId = "viewer-1" as ViewerId;

const setup = () => {
	const [core, widgetSide] = createDirectTransportPair<
		CoreToWidget,
		WidgetToCore
	>();
	const messages: WidgetToCore["message"][] = [];
	core.subscribe((message) => messages.push(message.message));
	const widget = createPizdudesWidget(widgetSide, {
		tickMs: 0,
		heartbeatMs: 0,
		seed: 7,
	});
	return { core, widget, messages };
};

const init = (core: ReturnType<typeof setup>["core"]): void => {
	core.send({
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Init",
			widgetId,
			config: {},
			viewport: { w: 1280, h: 720 },
		},
	});
};

const viewerEvent = (
	core: ReturnType<typeof setup>["core"],
	event: ViewerEvent,
): void => {
	core.send({
		protocolVersion: PROTOCOL_VERSION,
		message: { _tag: "ViewerEvent", event },
	});
};

const commandsOf = (messages: readonly WidgetToCore["message"][]) =>
	messages.flatMap((message) =>
		message._tag === "Batch" ? message.commands : [],
	);

describe("pizdudes widget", () => {
	it("sends Ready before the first render command", () => {
		const { core, messages } = setup();
		init(core);

		expect(messages[0]).toMatchObject({
			_tag: "Ready",
			widgetId,
			protocolVersion: PROTOCOL_VERSION,
		});
		expect(messages[1]?._tag).toBe("Batch");
	});

	it("creates the floor, every station and the scene on init", () => {
		const { core, messages } = setup();
		init(core);

		const commands = commandsOf(messages);
		const sprites = commands
			.filter((command) => command._tag === "SetSprite")
			.map((command) => command.assetId);

		expect(sprites[0]).toBe("floor");
		for (const station of STATION_NAMES) {
			expect(sprites).toContain(`stations/${station}`);
		}
	});

	it("spawns a cook with a badge on ViewerJoined", () => {
		const { core, messages } = setup();
		init(core);
		messages.length = 0;

		viewerEvent(core, {
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Кукуруза",
			color: "#ff8800",
		});

		const commands = commandsOf(messages);
		expect(commands).toContainEqual({
			_tag: "CreateNode",
			nodeId: "cook:viewer-1",
			kind: "container",
		});
		expect(commands).toContainEqual({
			_tag: "SetText",
			nodeId: "cook:viewer-1:badge-text",
			text: "Кукуруза",
			style: { fontSize: 12, fill: "#ff8800", align: "center" },
		});
	});

	it("moves a cook and plays the walk animation on tick", () => {
		const { core, widget, messages } = setup();
		init(core);
		viewerEvent(core, {
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Кукуруза",
		});
		messages.length = 0;

		widget.tick(500);

		const commands = commandsOf(messages);
		const transform = commands.find(
			(command) =>
				command._tag === "SetTransform" && command.nodeId === "cook:viewer-1",
		);
		const animation = commands.find(
			(command) =>
				command._tag === "SetAnimation" &&
				command.nodeId === "cook:viewer-1:sprite",
		);

		expect(transform).toMatchObject({ x: expect.any(Number) });
		expect(animation).toMatchObject({
			fps: COOK_FPS,
			loop: true,
		});
	});

	it("does not repeat the animation while the direction is unchanged", () => {
		const { core, widget, messages } = setup();
		init(core);
		viewerEvent(core, {
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Кукуруза",
		});
		widget.tick(100);
		messages.length = 0;

		widget.tick(100);

		const animations = commandsOf(messages).filter(
			(command) => command._tag === "SetAnimation",
		);
		expect(animations).toEqual([]);
	});

	it("stops sending commands while paused", () => {
		const { core, widget, messages } = setup();
		init(core);
		viewerEvent(core, {
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Кукуруза",
		});
		core.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Pause" },
		});
		messages.length = 0;

		widget.tick(500);

		expect(messages).toEqual([]);
	});

	it("removes the cook on ViewerLeft", () => {
		const { core, messages } = setup();
		init(core);
		viewerEvent(core, {
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Кукуруза",
		});
		messages.length = 0;

		viewerEvent(core, { _tag: "ViewerLeft", viewerId });

		expect(commandsOf(messages)).toContainEqual({
			_tag: "RemoveNode",
			nodeId: "cook:viewer-1",
		});
	});

	it("rescales the floor when the viewport changes", () => {
		const { core, messages } = setup();
		init(core);
		messages.length = 0;

		core.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Viewport", w: 600, h: 600 },
		});

		const floor = commandsOf(messages).find(
			(command) =>
				command._tag === "SetTransform" && command.nodeId === "floor",
		);
		expect(floor).toMatchObject({ scaleX: 600 / 1200, scaleY: 600 / 1200 });
	});

	it("removes the scene on Dispose", () => {
		const { core, widget, messages } = setup();
		init(core);
		messages.length = 0;

		core.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Dispose" },
		});
		widget.tick(500);

		expect(commandsOf(messages)).toContainEqual({
			_tag: "RemoveNode",
			nodeId: "scene",
		});
		expect(messages.filter((message) => message._tag === "Batch")).toHaveLength(
			1,
		);
	});

	it("maps velocity to the eight walk directions", () => {
		expect(directionFromVelocity(1, 0)).toBe("east");
		expect(directionFromVelocity(1, 1)).toBe("south-east");
		expect(directionFromVelocity(0, 1)).toBe("south");
		expect(directionFromVelocity(-1, 1)).toBe("south-west");
		expect(directionFromVelocity(-1, 0)).toBe("west");
		expect(directionFromVelocity(-1, -1)).toBe("north-west");
		expect(directionFromVelocity(0, -1)).toBe("north");
		expect(directionFromVelocity(1, -1)).toBe("north-east");
		expect(cookFrames("north")).toHaveLength(8);
	});
});
