const models = require('../../models');
const tpl = require('@tryghost/tpl');
const errors = require('@tryghost/errors');
const getPostServiceInstance = require('../../services/posts/posts-service');
const allowedIncludes = [
    'tags',
    'authors',
    'authors.roles',
    'email',
    'tiers',
    'newsletter',
    'count.conversions', 
    'count.signups',
    'count.paid_conversions',
    'count.clicks',
    'sentiment',
    'count.positive_feedback',
    'count.negative_feedback'
];
const unsafeAttrs = ['status', 'authors', 'visibility'];

const messages = {
    postNotFound: 'Post not found.'
};

const postsService = getPostServiceInstance();

module.exports = {
    docName: 'posts',
    browse: {
        options: [
            'include',
            'filter',
            'fields',
            'formats',
            'limit',
            'order',
            'page',
            'debug',
            'absolute_urls'
        ],
        validation: {
            options: {
                include: {
                    values: allowedIncludes
                },
                formats: {
                    values: models.Post.allowedFormats
                }
            }
        },
        permissions: {
            unsafeAttrs: unsafeAttrs
        },
        query(frame) {
            return models.Post.findPage(frame.options);
        }
    },

    read: {
        options: [
            'include',
            'fields',
            'formats',
            'debug',
            'absolute_urls',
            // NOTE: only for internal context
            'forUpdate',
            'transacting'
        ],
        data: [
            'id',
            'slug',
            'uuid'
        ],
        validation: {
            options: {
                include: {
                    values: allowedIncludes
                },
                formats: {
                    values: models.Post.allowedFormats
                }
            }
        },
        permissions: {
            unsafeAttrs: unsafeAttrs
        },
        query(frame) {
            return models.Post.findOne(frame.data, frame.options)
                .then((model) => {
                    if (!model) {
                        throw new errors.NotFoundError({
                            message: tpl(messages.postNotFound)
                        });
                    }

                    return model;
                });
        }
    },

    add: {
        statusCode: 201,
        headers: {},
        options: [
            'include',
            'formats',
            'source'
        ],
        validation: {
            options: {
                include: {
                    values: allowedIncludes
                },
                source: {
                    values: ['html']
                }
            }
        },
        permissions: {
            unsafeAttrs: unsafeAttrs
        },
        query(frame) {
            return models.Post.add(frame.data.posts[0], frame.options)
                .then((model) => {
                    if (model.get('status') !== 'published') {
                        this.headers.cacheInvalidate = false;
                    } else {
                        this.headers.cacheInvalidate = true;
                    }

                    return model;
                });
        }
    },

    edit: {
        headers: {},
        options: [
            'include',
            'id',
            'formats',
            'source',
            'email_segment',
            'newsletter',
            'force_rerender',
            // NOTE: only for internal context
            'forUpdate',
            'transacting'
        ],
        validation: {
            options: {
                include: {
                    values: allowedIncludes
                },
                id: {
                    required: true
                },
                source: {
                    values: ['html']
                }
            }
        },
        permissions: {
            unsafeAttrs: unsafeAttrs
        },
        async query(frame) {
            let user = await models.User.findOne({id: frame.options.context.user}); // FIXME: don't make an extra query?
            let roles = JSON.parse(JSON.stringify(await user.roles().fetch())); // HACK: lol wut
            let canEmail = roles.some(({name}) => ['Owner', 'Administrator', 'Editor'].includes(name));

            // Prevent authors from sending emails.
            if (!canEmail) {
                delete frame.options?.newsletter;
                delete frame.options?.email_segment;
            }

            let model = await postsService.editPost(frame);

            this.headers.cacheInvalidate = postsService.handleCacheInvalidation(model);

            return model;
        }
    },

    destroy: {
        statusCode: 204,
        headers: {
            cacheInvalidate: true
        },
        options: [
            'include',
            'id'
        ],
        validation: {
            options: {
                include: {
                    values: allowedIncludes
                },
                id: {
                    required: true
                }
            }
        },
        permissions: {
            unsafeAttrs: unsafeAttrs
        },
        query(frame) {
            return models.Post.destroy({...frame.options, require: true});
        }
    }
};
