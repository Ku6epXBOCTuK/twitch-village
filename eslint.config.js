import tseslint from "typescript-eslint";

const RUNTIME_IMPORTS = ["Context", "Layer", "Runtime", "ManagedRuntime"];
const RUNTIME_PATHS = [
	"effect/Context",
	"effect/Layer",
	"effect/Runtime",
	"effect/ManagedRuntime",
];

const runtimeImportBan = (message) => ({
	name: "effect",
	importNames: RUNTIME_IMPORTS,
	allowTypeImports: true,
	message,
});

const runtimePathBan = (message) => ({
	group: RUNTIME_PATHS,
	allowTypeImports: true,
	message,
});

const WIDGET_BAN = {
	group: ["@tv/widget-*"],
	message: "core must stay widget-agnostic.",
};

export default tseslint.config(
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/dist-assets/**",
			"**/.turbo/**",
		],
	},
	...tseslint.configs.recommended,
	{
		files: ["packages/protocol/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "pixi.js",
							message: "protocol must not depend on rendering.",
						},
						{ name: "@tv/core", message: "protocol must not depend on core." },
						runtimeImportBan(
							"protocol uses only Schema, Data and Match from Effect.",
						),
					],
					patterns: [
						{
							group: ["@tv/widget-*"],
							message: "protocol must not depend on widgets.",
						},
						runtimePathBan(
							"protocol uses only Schema, Data and Match from Effect.",
						),
					],
				},
			],
		},
	},
	{
		files: ["packages/core/src/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						runtimeImportBan(
							"Layer and ManagedRuntime are assembled only in live.ts.",
						),
					],
					patterns: [
						WIDGET_BAN,
						runtimePathBan(
							"Layer and ManagedRuntime are assembled only in live.ts.",
						),
					],
				},
			],
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression[callee.property.name='runSync'], CallExpression[callee.property.name='runSyncExit']",
					message:
						"runSync is allowed only in effect-adapter.ts, otherwise Effect leaks into the frame.",
				},
			],
		},
	},
	{
		files: ["packages/core/src/live.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ paths: [], patterns: [WIDGET_BAN] },
			],
		},
	},
	{
		files: ["packages/core/src/effect-adapter.ts"],
		rules: {
			"no-restricted-syntax": "off",
		},
	},
	{
		files: ["packages/core/src/**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ paths: [], patterns: [WIDGET_BAN] },
			],
			"no-restricted-syntax": "off",
		},
	},
	{
		files: [
			"packages/core/src/pixi/**/*.ts",
			"packages/core/src/nodes/pixi-render-target.ts",
		],
		ignores: ["**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "effect",
							allowTypeImports: true,
							message:
								"the Pixi layer receives dependencies explicitly, without Context.",
						},
					],
					patterns: [
						WIDGET_BAN,
						{
							group: ["effect/*"],
							allowTypeImports: true,
							message:
								"the Pixi layer receives dependencies explicitly, without Context.",
						},
					],
				},
			],
		},
	},
	{
		files: ["packages/widget-village/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "pixi.js", message: "rendering lives only in core." },
						{ name: "@tv/core", message: "a widget must not depend on core." },
						runtimeImportBan(
							"a widget is plain TS; Effect does not cross the worker boundary.",
						),
					],
					patterns: [
						runtimePathBan(
							"a widget is plain TS; Effect does not cross the worker boundary.",
						),
					],
				},
			],
			"no-restricted-globals": ["error", "document", "window"],
		},
	},
	{
		files: ["packages/event-mock/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "pixi.js", message: "rendering lives only in core." },
						{
							name: "@tv/core",
							message: "event-mock must not depend on core.",
						},
						runtimeImportBan("events do not need the Effect runtime."),
					],
					patterns: [runtimePathBan("events do not need the Effect runtime.")],
				},
			],
		},
	},
);
