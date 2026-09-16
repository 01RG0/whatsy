import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Environment configuration
 */
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY || "";
const ZERNIO_BASE_URL = (
  process.env.ZERNIO_BASE_URL || "https://api.zernio.com/v1"
).replace(/\/$/, "");

/**
 * Generic helper to make authenticated requests to the Zernio API
 */
async function callZernioApi(
  endpoint: string,
  method: "GET" | "POST" | "DELETE" | "PUT" = "GET",
  body?: Record<string, unknown>
): Promise<any> {
  if (!ZERNIO_API_KEY) {
    throw new Error(
      "ZERNIO_API_KEY environment variable is missing. Please set it in your MCP configuration."
    );
  }

  const url = `${ZERNIO_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ZERNIO_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(
      `Zernio API request failed [${response.status} ${response.statusText}]: ${errorDetail}`
    );
  }

  return await response.json();
}

/**
 * Tool definitions exposed to Claude
 */
const TOOLS: Tool[] = [
  {
    name: "send_whatsapp_message",
    description:
      "Send a standard WhatsApp text, image, document, or audio message via Zernio to a recipient phone number.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description:
            "Recipient phone number in E.164 international format (e.g. +14155552671).",
        },
        message: {
          type: "string",
          description: "Text content of the message.",
        },
        mediaUrl: {
          type: "string",
          description:
            "Optional public URL of media (image/pdf/audio) to attach.",
        },
        mediaType: {
          type: "string",
          enum: ["image", "document", "audio", "video"],
          description: "Type of media being sent if mediaUrl is provided.",
        },
        channelId: {
          type: "string",
          description:
            "Optional Zernio WhatsApp channel/account ID if multiple channels exist.",
        },
      },
      required: ["recipient", "message"],
    },
  },
  {
    name: "send_whatsapp_template",
    description:
      "Send a Meta-approved WhatsApp Business message template with dynamic parameter substitutions via Zernio.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description:
            "Recipient phone number in international format (+14155552671).",
        },
        templateName: {
          type: "string",
          description: "Registered template name approved by Meta (e.g. order_confirmation_v2).",
        },
        languageCode: {
          type: "string",
          description: "Language code for the template (e.g. en_US, ar, es, fr). Defaults to en_US.",
          default: "en_US",
        },
        components: {
          type: "array",
          description:
            "Template parameters formatted by component (header, body, button).",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["header", "body", "button"],
                description: "Component type.",
              },
              parameters: {
                type: "array",
                description: "List of variable replacements in order {{1}}, {{2}}, etc.",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["text", "image", "document", "payload"],
                    },
                    text: { type: "string" },
                    image: {
                      type: "object",
                      properties: { link: { type: "string" } },
                    },
                    payload: { type: "string" },
                  },
                },
              },
            },
            required: ["type", "parameters"],
          },
        },
        channelId: {
          type: "string",
          description: "Optional Zernio WhatsApp channel ID.",
        },
      },
      required: ["recipient", "templateName"],
    },
  },
  {
    name: "list_inbox_conversations",
    description:
      "Fetch active customer conversations and message threads from the Zernio unified inbox.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Filter by channel type, e.g., 'whatsapp', 'instagram', 'facebook'.",
          default: "whatsapp",
        },
        status: {
          type: "string",
          enum: ["open", "pending", "resolved", "all"],
          description: "Filter conversations by status.",
          default: "open",
        },
        limit: {
          type: "number",
          description: "Maximum number of conversations to retrieve (1-100). Default is 20.",
          default: 20,
        },
        page: {
          type: "number",
          description: "Pagination page number.",
          default: 1,
        },
      },
    },
  },
  {
    name: "get_post_analytics",
    description:
      "Retrieve performance metrics, reach, engagement, and delivery statistics for social or broadcast posts.",
    inputSchema: {
      type: "object",
      properties: {
        postId: {
          type: "string",
          description: "Unique post or broadcast ID in Zernio.",
        },
        channel: {
          type: "string",
          description: "Optional channel name ('whatsapp', 'twitter', 'linkedin', 'instagram').",
        },
        dateRange: {
          type: "string",
          description: "Reporting time range: '24h', '7d', '30d', 'all'. Default is '7d'.",
          default: "7d",
        },
      },
      required: ["postId"],
    },
  },
  {
    name: "create_social_post",
    description:
      "Publish or schedule cross-platform social media posts across Twitter/X, LinkedIn, Facebook, Instagram, and WhatsApp status/broadcasts via Zernio.",
    inputSchema: {
      type: "object",
      properties: {
        platforms: {
          type: "array",
          items: {
            type: "string",
            enum: ["twitter", "linkedin", "instagram", "facebook", "whatsapp_channel"],
          },
          description: "List of destination social platforms.",
        },
        content: {
          type: "string",
          description: "The primary post caption/content text.",
        },
        mediaUrls: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of image/video asset URLs to include in the post.",
        },
        scheduledAt: {
          type: "string",
          description:
            "ISO 8601 UTC timestamp to schedule post for future publishing (e.g. 2026-10-01T14:00:00Z). If omitted, publishes immediately.",
        },
      },
      required: ["platforms", "content"],
    },
  },
];

/**
 * Initialize and start the MCP server
 */
async function runServer() {
  const server = new Server(
    {
      name: "zernio-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Expose list of tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool execution requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "send_whatsapp_message": {
          const { recipient, message, mediaUrl, mediaType, channelId } =
            (args || {}) as any;

          const payload: Record<string, unknown> = {
            recipient,
            message,
            channel: "whatsapp",
          };
          if (mediaUrl) {
            payload.media = {
              url: mediaUrl,
              type: mediaType || "image",
            };
          }
          if (channelId) {
            payload.channel_id = channelId;
          }

          const result = await callZernioApi(
            "/messages/send",
            "POST",
            payload
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    message: "WhatsApp message dispatched successfully",
                    data: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "send_whatsapp_template": {
          const { recipient, templateName, languageCode, components, channelId } =
            (args || {}) as any;

          const payload: Record<string, unknown> = {
            recipient,
            template: {
              name: templateName,
              language: { code: languageCode || "en_US" },
              components: components || [],
            },
            channel: "whatsapp",
          };
          if (channelId) {
            payload.channel_id = channelId;
          }

          const result = await callZernioApi(
            "/messages/template",
            "POST",
            payload
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    message: "WhatsApp template message queued successfully",
                    data: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "list_inbox_conversations": {
          const { channel = "whatsapp", status = "open", limit = 20, page = 1 } =
            (args || {}) as any;

          const query = new URLSearchParams({
            channel,
            status,
            limit: String(limit),
            page: String(page),
          }).toString();

          const result = await callZernioApi(`/inbox/conversations?${query}`, "GET");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    conversations: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_post_analytics": {
          const { postId, channel, dateRange = "7d" } = (args || {}) as any;

          const query = new URLSearchParams({
            range: dateRange,
            ...(channel ? { channel } : {}),
          }).toString();

          const result = await callZernioApi(
            `/posts/${encodeURIComponent(postId)}/analytics?${query}`,
            "GET"
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    analytics: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "create_social_post": {
          const { platforms, content, mediaUrls, scheduledAt } =
            (args || {}) as any;

          const payload: Record<string, unknown> = {
            platforms,
            content,
            media_urls: mediaUrls || [],
          };
          if (scheduledAt) {
            payload.scheduled_at = scheduledAt;
          }

          const result = await callZernioApi("/posts", "POST", payload);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    message: scheduledAt
                      ? "Post scheduled successfully"
                      : "Post published immediately",
                    data: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Unknown tool requested: ${name}`,
              },
            ],
          };
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing tool '${name}': ${err.message || String(err)}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zernio MCP Server running via stdio transport.");
}

runServer().catch((error) => {
  console.error("Fatal error starting Zernio MCP server:", error);
  process.exit(1);
});
