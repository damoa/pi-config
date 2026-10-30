import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, Key, matchesKey, type SelectItem } from "@earendil-works/pi-tui";
type PricingModel = {
	provider: string;
	id: string;
	cost?: {
		input?: unknown;
		output?: unknown;
		cacheRead?: unknown;
		cacheWrite?: unknown;
	} | null;
};

const STATUS_KEY = "model-pricing";

function validPrice(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatPricePerMillion(value: unknown): string | undefined {
	if (!validPrice(value)) return undefined;
	if (value === 0) return "$0";
	if (value >= 0.01) return `$${value.toFixed(2)}`;
	if (value >= 1e-12) {
		const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(value)) + 2));
		return `$${value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
	}
	return `$${value.toExponential(3)}`;
}

function formatModelPricing(model: PricingModel): string {
	const cost = model.cost;
	const input = formatPricePerMillion(cost?.input);
	const output = formatPricePerMillion(cost?.output);
	const name = `${model.provider}/${model.id}`;
	if (input === undefined || output === undefined) return `${name} — pricing unavailable`;
	const parts = [`${input} input`, `${output} output`];
	const cacheRead = formatPricePerMillion(cost?.cacheRead);
	const cacheWrite = formatPricePerMillion(cost?.cacheWrite);
	if (cacheRead !== undefined) parts.push(`${cacheRead} cache-read`);
	if (cacheWrite !== undefined) parts.push(`${cacheWrite} cache-write`);
	return `${name} — ${parts.join(" / ")} per 1M tokens`;
}

function registryModel(ctx: { modelRegistry: { find(provider: string, modelId: string): PricingModel | undefined } }, model: PricingModel | undefined) {
	return model ? ctx.modelRegistry.find(model.provider, model.id) ?? model : undefined;
}

export default function (pi: ExtensionAPI) {
	const update = (ctx: ExtensionContext, model: PricingModel | undefined) => {
		ctx.ui.setStatus(STATUS_KEY, model ? formatModelPricing(model) : "pricing unavailable");
	};

	pi.registerCommand("model-prices", {
		description: "Select a model with registry pricing (use /model for Pi's native selector)",
		handler: async (searchTerm, ctx) => {
			const models = ctx.scopedModels.length > 0
				? ctx.scopedModels.map(({ model }) => model)
				: ctx.modelRegistry.getAvailable();
			if (models.length === 0) {
				ctx.ui.notify("No available models", "warning");
				return;
			}

			const byId = new Map<string, (typeof models)[number]>();
			const items: SelectItem[] = models.map((model) => {
				const value = `${model.provider}/${model.id}`;
				byId.set(value, model);
				return { value, label: value };
			});
			const selected = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
				let filter = searchTerm.trim();
				let selectedModel = models[0];
				const search = new Text("", 1, 0);
				const pricing = new Text("", 1, 0);
				const list = new SelectList(items, Math.min(12, items.length), getSelectListTheme());
				const updateSelection = (item: SelectItem | null) => {
					selectedModel = item ? byId.get(item.value) ?? selectedModel : selectedModel;
					search.setText(theme.fg("dim", `filter: ${filter || "(all models)"}`));
					pricing.setText(theme.fg("accent", formatModelPricing(selectedModel)));
					tui.requestRender();
				};
				list.onSelectionChange = updateSelection;
				list.setFilter(filter);
				updateSelection(list.getSelectedItem());
				const container = new Container();
				container.addChild(search);
				container.addChild(list);
				container.addChild(pricing);
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape)) return done(undefined);
						if (matchesKey(data, Key.enter)) return done(selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : undefined);
						if (matchesKey(data, Key.backspace)) filter = filter.slice(0, -1);
						else if (matchesKey(data, Key.ctrl("u"))) filter = "";
						else if (data.length === 1 && data.charCodeAt(0) >= 32) filter += data;
						else {
							list.handleInput(data);
							return;
						}
						list.setFilter(filter);
						updateSelection(list.getSelectedItem());
					},
				};
			});
			const model = selected ? byId.get(selected) : undefined;
			if (model && !(await pi.setModel(model))) {
				ctx.ui.notify(`No authentication configured for ${model.provider}`, "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		update(ctx, registryModel(ctx, ctx.model));
	});

	pi.on("model_select", (event, ctx) => {
		update(ctx, registryModel(ctx, event.model));
	});
}
