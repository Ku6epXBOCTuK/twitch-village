import { DefaultReporter } from "vitest/node";
import type { BaseReporter, TestModule } from "vitest/node";

export default class FailuresFirstReporter extends DefaultReporter {
	private buffered: TestModule[] = [];

	protected override printTestModule(testModule: TestModule): void {
		this.buffered.push(testModule);
	}

	override reportTestSummary(
		...args: Parameters<BaseReporter["reportTestSummary"]>
	): void {
		for (const testModule of this.buffered) super.printTestModule(testModule);
		this.buffered = [];
		super.reportTestSummary(...args);
	}
}
