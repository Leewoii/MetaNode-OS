# n8n Node UX Notes For Baryon

Research target: copy useful interaction patterns, not n8n internals.

## Patterns To Keep

- Node library is searchable and grouped by purpose.
- Node operations split into triggers and actions.
- Trigger nodes start executions; action nodes process/send/transform data.
- Core nodes cover generic workflow needs: manual, schedule, webhook, HTTP request, code/transform, logic, merge, file, and workflow calls.
- Node config should use form fields with resources/operations first, then required fields, then optional fields.
- Credentials are first-class node config, but secrets stay outside node JSON.
- Workflow data passes as item arrays containing JSON and optional binary data.
- Canvas supports drag/drop, keyboard movement, node execution, stale-run markers, and sticky notes.
- SMTP email nodes need server host, port, encryption mode, auth method, username/password or OAuth token, from/reply-to, recipients, subject, body type, body, and optional attachment field.

## Baryon v1 Mapping

- Added searchable draggable node library.
- Added categories: Triggers, AI, Core, Data, IT Ops, Channels.
- Kept only engine-supported nodes visible:
  - Manual Trigger, Schedule Trigger, Webhook Trigger
  - Telegram Trigger, WhatsApp Trigger
  - AI Agent
  - Approval, Notify, HTTP Request, JSON Transform
  - File, Git, Shell, SSH
- Cards can be clicked or dragged onto canvas.
- Cards show node kind badge: trigger, action, agent.

## Sources

- n8n built-in node types: https://docs.n8n.io/integrations/builtin/node-types/
- n8n node type planning: https://docs.n8n.io/integrations/creating-nodes/plan/node-types/
- n8n node UI design: https://docs.n8n.io/integrations/creating-nodes/plan/node-ui-design/
- n8n workflow components: https://docs.n8n.io/workflows/components/
- n8n keyboard/canvas controls: https://docs.n8n.io/keyboard-shortcuts/
