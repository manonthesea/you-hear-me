/*
 * A reader's trail through the poems.
 *
 * Every link in a poem is a phrase, and the phrase is the link's own
 * text, so a click already carries the whole edge - which page, which
 * words, where they lead - and the page needs no markup describing
 * itself for this to work.
 *
 * What is sent is that edge and nothing else. No identifier, no
 * session, no cookie, nothing that tells one reader from another. Two
 * people crossing the same link are indistinguishable, on purpose: the
 * question is which paths get walked, not who walked them.
 */
(function () {
    'use strict';

    var ENDPOINT = 'https://you-hear-me-trail.ericjseaman.workers.dev/';

    try {
        // A reader who has asked not to be followed is not followed.
        if (
            navigator.doNotTrack === '1' ||
            window.doNotTrack === '1' ||
            navigator.msDoNotTrack === '1' ||
            navigator.globalPrivacyControl
        ) {
            return;
        }
        if (!navigator.sendBeacon) return;
    } catch (e) {
        return;
    }

    // Capturing, so the report is made before anything else on the page
    // has a chance to stop the click from travelling.
    document.addEventListener(
        'click',
        function (event) {
            try {
                var target = event.target;
                if (!target || !target.closest) return;
                var link = target.closest('a[href]');
                if (!link) return;

                var to = new URL(link.getAttribute('href'), location.href);
                // Somewhere else on the site. An outbound link is
                // somebody else's business, and is left alone.
                if (to.origin !== location.origin) return;
                // A link to the very page you are on is a jump within
                // it, not a crossing.
                if (to.pathname === location.pathname) return;

                var crossing = JSON.stringify({
                    from: location.pathname,
                    to: to.pathname,
                    // What the ledger calls this link, straight out of
                    // the page, because the phrase is the link text.
                    phrase: (link.textContent || '').trim().slice(0, 120),
                });

                // "text/plain" keeps this a simple request, so the
                // browser sends it without first asking the endpoint's
                // permission - a round trip the page would often be
                // gone before finishing.
                navigator.sendBeacon(ENDPOINT, new Blob([crossing], { type: 'text/plain' }));
            } catch (e) {
                // A trail that breaks a poem is worse than no trail.
            }
        },
        true
    );
})();
