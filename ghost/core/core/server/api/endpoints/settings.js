const _ = require('lodash');
const models = require('../../models');
const routeSettings = require('../../services/route-settings');
const {BadRequestError} = require('@tryghost/errors');
const settingsService = require('../../services/settings/settings-service');
const membersService = require('../../services/members');
const stripeService = require('../../services/stripe');
const settingsBREADService = settingsService.getSettingsBREADServiceInstance();

async function getStripeConnectData(frame) {
    const stripeConnectIntegrationToken = frame.data.settings.find(setting => setting.key === 'stripe_connect_integration_token');

    if (stripeConnectIntegrationToken && stripeConnectIntegrationToken.value) {
        const getSessionProp = prop => frame.original.session[prop];

        return await settingsBREADService.getStripeConnectData(
            stripeConnectIntegrationToken,
            getSessionProp,
            membersService.stripeConnect.getStripeConnectTokenData
        );
    }
}

module.exports = {
    docName: 'settings',

    browse: {
        options: ['group'],
        permissions: true,
        async query(frame) {
            let user = await models.User.findOne({id: frame.options.context.user}); // FIXME: don't make an extra query?
            let roles = JSON.parse(JSON.stringify(await user.roles().fetch())); // HACK: lol wut
            let canEmail = roles.some(({name}) => ['Owner', 'Administrator', 'Editor'].includes(name));

            const result = settingsBREADService.browse(frame.options.context);

            // Prevent authors from sending emails.
            if (canEmail) {
                return result;
            } else {
                return result.filter(setting => setting.key !== 'mailgun_api_key');
            }

        }
    },

    read: {
        options: ['key'],
        validation: {
            options: {
                key: {
                    required: true
                }
            }
        },
        permissions: {
            identifier(frame) {
                return frame.options.key;
            }
        },
        query(frame) {
            return settingsBREADService.read(frame.options.key, frame.options.context);
        }
    },

    verifyKeyUpdate: {
        headers: {
            cacheInvalidate: true
        },
        permissions: {
            method: 'edit'
        },
        data: [
            'token'
        ],
        async query(frame) {
            await settingsBREADService.verifyKeyUpdate(frame.data.token);

            // We need to return all settings here, because we have calculated settings that might change
            const browse = await settingsBREADService.browse(frame.options.context);

            return browse;
        }
    },

    disconnectStripeConnectIntegration: {
        statusCode: 204,
        permissions: {
            method: 'edit'
        },
        async query(frame) {
            const paidMembers = await membersService.api.memberBREADService.browse({limit: 0, filter: 'status:paid'});
            if (_.get(paidMembers, 'meta.pagination.total') !== 0) {
                throw new BadRequestError({
                    message: 'Cannot disconnect Stripe whilst you have active subscriptions.'
                });
            }

            await stripeService.disconnect();

            return models.Settings.edit([{
                key: 'stripe_connect_publishable_key',
                value: null
            }, {
                key: 'stripe_connect_secret_key',
                value: null
            }, {
                key: 'stripe_connect_livemode',
                value: null
            }, {
                key: 'stripe_connect_display_name',
                value: null
            }, {
                key: 'stripe_connect_account_id',
                value: null
            }, {
                key: 'members_stripe_webhook_id',
                value: null
            }, {
                key: 'members_stripe_webhook_secret',
                value: null
            }], frame.options);
        }
    },

    edit: {
        headers: {
            cacheInvalidate: true
        },
        permissions: {
            unsafeAttrsObject(frame) {
                return _.find(frame.data.settings, {key: 'labs'});
            }
        },
        async query(frame) {
            let stripeConnectData = await getStripeConnectData(frame);

            let result = await settingsBREADService.edit(frame.data.settings, frame.options, stripeConnectData);

            if (_.isEmpty(result)) {
                this.headers.cacheInvalidate = false;
            } else {
                this.headers.cacheInvalidate = true;
            }

            // We need to return all settings here, because we have calculated settings that might change
            const browse = await settingsBREADService.browse(frame.options.context);
            browse.meta = result.meta || {};

            return browse;
        }
    },

    upload: {
        headers: {
            cacheInvalidate: true
        },
        permissions: {
            method: 'edit'
        },
        async query(frame) {
            await routeSettings.api.setFromFilePath(frame.file.path);
            const getRoutesHash = () => routeSettings.api.getCurrentHash();
            await settingsService.syncRoutesHash(getRoutesHash);
        }
    },

    download: {
        headers: {
            disposition: {
                type: 'yaml',
                value: 'routes.yaml'
            }
        },
        response: {
            format: 'plain'
        },
        permissions: {
            method: 'browse'
        },
        query() {
            return routeSettings.api.get();
        }
    }
};
