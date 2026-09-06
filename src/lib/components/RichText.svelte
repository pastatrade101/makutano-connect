<script lang="ts">
	/**
	 * The composer's rich text field.
	 *
	 * Deliberately no editor library. Tiptap or Quill would each add hundreds of
	 * kilobytes to a page that is already a six-step form, and would bring their
	 * own document model and their own idea of what tags exist — while the tag
	 * set here is not ours to choose freely. It is fixed at both ends: by the
	 * server's allow-list (src/lib/server/richtext.ts) and by what the purchased
	 * marketplace theme styles inside .mk-prose. A toolbar that can only produce
	 * those tags is the honest size of the problem.
	 *
	 * The value is an HTML string. It is sanitised again on save and a third time
	 * when the public API serves it, so nothing here is a security control — this
	 * is about what an operator can express, not about what a browser will run.
	 */
	type LinkTarget = { slug: string; title: string };

	let {
		value = $bindable<string>(''),
		id,
		rows = 6,
		placeholder = '',
		linkTargets = [] as LinkTarget[]
	}: {
		value: string;
		id?: string;
		rows?: number;
		placeholder?: string;
		linkTargets?: LinkTarget[];
	} = $props();

	let editor = $state<HTMLDivElement | null>(null);
	let focused = $state(false);
	let linkOpen = $state(false);
	let linkQuery = $state('');
	let savedRange: Range | null = null;

	const matches = $derived(
		linkQuery.trim()
			? linkTargets
					.filter((t) => t.title.toLowerCase().includes(linkQuery.trim().toLowerCase()))
					.slice(0, 8)
			: linkTargets.slice(0, 8)
	);

	/*
	 * Write into the element only when the value came from somewhere else.
	 *
	 * Assigning innerHTML on every keystroke would collapse the selection to the
	 * start of the field on every character typed — the classic contenteditable
	 * bug. While the field has focus the DOM is the source of truth; the binding
	 * follows it, not the other way round.
	 */
	$effect(() => {
		const incoming = value ?? '';
		if (editor && !focused && editor.innerHTML !== incoming) editor.innerHTML = incoming;
	});

	function emit() {
		if (!editor) return;
		const html = editor.innerHTML.trim();
		// An empty contenteditable is "<br>" or "<div><br></div>", never "".
		value = html === '<br>' || html === '<div><br></div>' ? '' : html;
	}

	function exec(command: string, argument?: string) {
		editor?.focus();
		document.execCommand(command, false, argument);
		emit();
	}

	/** A heading toggles: pressing it on an existing heading returns to a paragraph. */
	function block(tag: 'h3' | 'h4' | 'blockquote') {
		const current = document.queryCommandValue('formatBlock').toLowerCase();
		exec('formatBlock', current === tag ? 'p' : tag);
	}

	/*
	 * Paste arrives as plain text, always.
	 *
	 * Copying out of Word or a web page brings spans, inline colours, fonts and
	 * class names. The server strips them, so the operator would see formatting
	 * appear in the composer and then silently vanish from the public page —
	 * which reads as the page being broken rather than the paste being refused.
	 * Refusing it here means what they see is what publishes.
	 */
	function onPaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
		emit();
	}

	function openLink() {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			// createLink needs something to wrap; without a selection it silently
			// does nothing, which looks like a broken button.
			alert('Select the words you want to turn into a link first.');
			return;
		}
		savedRange = selection.getRangeAt(0).cloneRange();
		linkQuery = '';
		linkOpen = true;
	}

	function applyLink(href: string) {
		if (savedRange) {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(savedRange);
		}
		exec('createLink', href);
		linkOpen = false;
		savedRange = null;
	}

	function unlink() {
		exec('unlink');
	}
</script>

<div class="rt" class:is-focused={focused}>
	<div class="rt__bar">
		<button type="button" onclick={() => exec('bold')} title="Bold"><b>B</b></button>
		<button type="button" onclick={() => exec('italic')} title="Italic"><i>I</i></button>
		<span class="rt__sep"></span>
		<button type="button" onclick={() => block('h3')} title="Heading">H</button>
		<button type="button" onclick={() => exec('insertUnorderedList')} title="Bulleted list">•—</button>
		<button type="button" onclick={() => exec('insertOrderedList')} title="Numbered list">1—</button>
		<span class="rt__sep"></span>
		<button type="button" onclick={openLink} title="Link to another tour or a web page">Link</button>
		<button type="button" onclick={unlink} title="Remove link">Unlink</button>
		<button type="button" onclick={() => exec('removeFormat')} title="Clear formatting">Clear</button>
	</div>

	<div
		{id}
		bind:this={editor}
		class="rt__area input"
		style="min-height: {rows * 1.6}rem"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		data-placeholder={placeholder}
		onfocus={() => (focused = true)}
		onblur={() => {
			focused = false;
			emit();
		}}
		oninput={emit}
		onpaste={onPaste}
	></div>

	{#if linkOpen}
		<div class="rt__link">
			<p class="rt__link-title">Link to one of your tours</p>
			<input
				class="input"
				type="search"
				placeholder="Search your published tours"
				bind:value={linkQuery}
			/>
			<ul class="rt__link-list">
				{#each matches as target (target.slug)}
					<li>
						<button type="button" onclick={() => applyLink(`/tours/${target.slug}`)}>
							{target.title}
							<small>/tours/{target.slug}</small>
						</button>
					</li>
				{:else}
					<li class="rt__link-empty">
						{linkTargets.length ? 'No tour matches that.' : 'Publish another tour to link to it.'}
					</li>
				{/each}
			</ul>
			<div class="rt__link-actions">
				<button
					type="button"
					class="rt__link-external"
					onclick={() => {
						const url = prompt('Web address (https://…)');
						if (url) applyLink(url);
					}}>Or link to a web page</button
				>
				<button type="button" onclick={() => (linkOpen = false)}>Cancel</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.rt {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.rt__bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
	}

	.rt__bar button {
		min-width: 30px;
		height: 28px;
		padding: 0 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: #475569;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}

	.rt__bar button:hover {
		border-color: #e2e8f0;
		background: #f8fafc;
		color: #0f172a;
	}

	.rt__sep {
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: #e2e8f0;
	}

	.rt__area {
		overflow-y: auto;
		max-height: 30rem;
		line-height: 1.55;
	}

	/* The placeholder, which a contenteditable does not get for free. */
	.rt__area:empty::before {
		color: #94a3b8;
		content: attr(data-placeholder);
	}

	/* What the operator types must look like what publishes, so these mirror
	   .mk-prose on the marketplace rather than inventing a second house style. */
	.rt__area :global(h3) {
		margin: 0.9em 0 0.3em;
		font-size: 1.05rem;
		font-weight: 650;
	}

	.rt__area :global(p) {
		margin: 0 0 0.6em;
	}

	.rt__area :global(ul),
	.rt__area :global(ol) {
		margin: 0 0 0.6em;
		padding-left: 1.35em;
	}

	.rt__area :global(li) {
		margin: 0.15em 0;
	}

	.rt__area :global(a) {
		color: #b4532a;
		text-decoration: underline;
	}

	.rt__link {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		background: #f8fafc;
	}

	.rt__link-title {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		color: #0f172a;
	}

	.rt__link-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 190px;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rt__link-list button {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		font-size: 13px;
		color: #0f172a;
		cursor: pointer;
	}

	.rt__link-list button:hover {
		background: #eef2f7;
	}

	.rt__link-list small {
		color: #64748b;
		font-size: 11px;
	}

	.rt__link-empty {
		padding: 6px 8px;
		color: #64748b;
		font-size: 12px;
	}

	.rt__link-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.rt__link-actions button {
		border: 0;
		background: transparent;
		font-size: 12px;
		color: #64748b;
		cursor: pointer;
	}

	.rt__link-external {
		color: #b4532a !important;
	}
</style>
