<!-- §17: a module the workspace does not use, reached by URL. Friendly, not a 500. -->
<script lang="ts">
	let { module }: { module: string } = $props();
</script>

<div class="card mx-auto max-w-md p-8 text-center">
	<p class="text-sm font-semibold text-slate-700">{module} isn't part of how you use Connect</p>
	<p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
		Your workspace is set up without {module.toLowerCase()}. If your business needs them, switch how you use Connect in
		Settings — your plan decides what is actually included.
	</p>
	<div class="mt-4 flex justify-center gap-2">
		<a href="/app/settings" class="btn-primary">Open Settings</a>
		<a href="/app" class="btn-secondary">Back to Home</a>
	</div>
</div>
