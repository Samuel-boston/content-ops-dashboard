/**
 * The Slack app, as a manifest: paste it into "Create app → From a manifest" and
 * the name, the bot, the /ops command, the event subscriptions and every
 * permission are set up in one go — nothing to configure by hand. The request
 * URLs are this dashboard's own addresses.
 */
export function slackManifest(appUrl: string, appName = "Content Ops") {
  const base = appUrl.replace(/\/$/, "");
  return {
    display_information: {
      name: appName,
      description: "Ask the content dashboard from Slack, and hear what moves.",
      background_color: "#3b3550",
    },
    features: {
      bot_user: { display_name: appName, always_online: true },
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      slash_commands: [
        {
          command: "/ops",
          url: `${base}/api/slack/command`,
          description: "Ask the content dashboard",
          usage_hint: "add idea … | how many in scripting | what's in review | find …",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "chat:write",
          "chat:write.public",
          "commands",
          "channels:read",
          "channels:join",
          "im:history",
          "im:read",
          "im:write",
          "users:read",
          "users:read.email",
        ],
      },
    },
    settings: {
      event_subscriptions: { request_url: `${base}/api/slack/events`, bot_events: ["app_mention", "message.im"] },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
