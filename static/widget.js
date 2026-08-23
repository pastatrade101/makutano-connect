/*!
 * Makutano Connect embeddable widget (framework-independent).
 *
 *   <script src="https://connect.makutano.co.tz/widget.js" data-widget="wf_…"></script>
 *
 * Renders the hosted form in a sandboxed iframe (no CSS or JS collisions with the
 * host page) and auto-sizes it. No keys, no tenant ids — only the opaque widget id.
 */
(function () {
	'use strict';
	var script = document.currentScript;
	if (!script) return;
	var widgetId = script.getAttribute('data-widget');
	if (!widgetId) {
		console.warn('[makutano-connect] missing data-widget attribute');
		return;
	}
	var origin = new URL(script.src).origin;

	var frame = document.createElement('iframe');
	frame.src = origin + '/f/' + encodeURIComponent(widgetId) + '?embed=1';
	frame.title = 'Enquiry form';
	frame.style.width = '100%';
	frame.style.border = '0';
	frame.style.display = 'block';
	frame.style.minHeight = '360px';
	frame.setAttribute('loading', 'lazy');

	var mount = script.getAttribute('data-mount');
	var host = mount ? document.querySelector(mount) : null;
	(host || script.parentNode).insertBefore(frame, host ? null : script);

	window.addEventListener('message', function (event) {
		if (event.origin !== origin) return;
		var d = event.data;
		if (d && d.type === 'mk-widget-height' && d.publicId === widgetId && typeof d.height === 'number') {
			frame.style.height = Math.max(280, Math.min(4000, d.height)) + 'px';
		}
	});
})();
