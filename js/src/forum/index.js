import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';

app.initializers.add('ekumanov/flarum-ext-new-posts-notice', () => {
    // ReplyComposer is in a lazy chunk in Flarum 2.0, so we defer patching until it loads.
    flarum.reg.onLoad('core', 'forum/components/ReplyComposer', (module) => {
        const ReplyComposer = module?.default ?? module;

        // Store the lastPostNumber when the reply editor is opened
        extend(ReplyComposer.prototype, 'oninit', function () {
            const discussion = this.attrs.discussion;
            if (discussion) {
                this.initialLastPostNumber = discussion.lastPostNumber();
            }
        });

        // Check for new posts before submitting
        override(ReplyComposer.prototype, 'onsubmit', async function (original) {
            // Core only sets `loading` inside original(), and we call that after
            // a network round trip — so without this a double-tap or a second
            // Ctrl+Enter during the check starts a second check, and both end
            // in a post. Core's onsubmit has no re-entry guard of its own either
            // (it relies on the loading overlay), so this also covers a repeat
            // press while core's own save is still in flight.
            if (this.loading) return;

            const discussion = this.attrs.discussion;

            if (!discussion || !this.initialLastPostNumber) {
                return original();
            }

            // With flarum/realtime, replies land in the stream while the user is
            // typing and they may well have read them already. Anything up to the
            // furthest post they have read is not news, so don't warn about it.
            const baseline = Math.max(this.initialLastPostNumber, discussion.lastReadPostNumber() || 0);

            // Show the loading overlay and disable the editor for the duration
            // of the check, exactly as core does for the save itself.
            this.loading = true;
            m.redraw();

            let currentLastPostNumber;

            try {
                // Only the one number we need. The full Show endpoint would also
                // serialize the first post, its author, the last post and the
                // whole post-id list; sparse fieldsets skip all of that, and the
                // store merges the lone attribute into the existing model rather
                // than replacing it, so nothing else on it is lost.
                const freshDiscussion = await app.store.find('discussions', discussion.id(), {
                    include: '',
                    fields: { discussions: 'lastPostNumber' },
                });
                currentLastPostNumber = freshDiscussion.lastPostNumber();
            } catch (error) {
                // On error, submit normally
                this.loading = false;
                return original();
            }

            const newPostsCount = currentLastPostNumber - baseline;

            if (newPostsCount > 0) {
                const raw = newPostsCount === 1
                    ? app.translator.trans('ekumanov-new-posts-notice.forum.new_posts_single')
                    : app.translator.trans('ekumanov-new-posts-notice.forum.new_posts_plural', { count: newPostsCount });
                const message = Array.isArray(raw) ? raw.join('') : raw;

                this.initialLastPostNumber = currentLastPostNumber;

                if (!confirm(message)) {
                    // User wants to read new posts first
                    this.loading = false;

                    // Scroll to first new post
                    m.route.set(app.route('discussion', { id: discussion.id() + '-' + discussion.slug() }), { near: baseline + 1 });

                    // Minimize so user can read
                    app.composer.minimize();
                    m.redraw();
                    return;
                }
            }

            // original() sets `loading` itself and clears it via loaded() if the
            // save fails, so hand over without resetting it here.
            return original();
        });
    });
});
