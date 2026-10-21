import tseslint from "typescript-eslint";
import { restrictedImports } from "./packages/config/eslint.base.js";

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
			"no-restricted-imports": restrictedImports([
				"pixi.js",
				"@tv/core",
				"@tv/widget-*",
			]),
		},
	},
	{
		files: ["packages/core/**/*.ts"],
		rules: {
			"no-restricted-imports": restrictedImports(["@tv/widget-*"]),
		},
	},
	{
		files: ["packages/widget-village/**/*.ts"],
		rules: {
			"no-restricted-imports": restrictedImports(["pixi.js", "@tv/core"]),
			"no-restricted-globals": ["error", "document", "window"],
		},
	},
	{
		files: ["packages/event-mock/**/*.ts"],
		rules: {
			"no-restricted-imports": restrictedImports(["pixi.js", "@tv/core"]),
		},
	},
);
