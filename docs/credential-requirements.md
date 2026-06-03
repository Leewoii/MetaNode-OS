# Credential Requirements Research

Scope: nodes in Baryon that require external service credentials.

## Credential-backed nodes and required access fields

| Node type | Minimum credential/access requirements |
|---|---|
| `telegram.send` | Bot token, chat ID |
| `whatsapp.send` | Meta access token, phone number ID, WABA ID |
| `discord.send` | Bot token or webhook URL, channel/thread target |
| `slack.send` | Bot token or webhook URL, channel target |
| `email.send` | SMTP host, port, encryption mode, auth (username/password or OAuth token), sender address |
| `gmail.action` | Google OAuth credential with Gmail scopes |
| `google.sheets` | Google OAuth credential with Sheets scopes |
| `google.drive` | Google OAuth credential with Drive scopes |
| `notion.action` | Notion integration token with page/database access |
| `airtable.action` | Airtable PAT/API token, base access |
| `hubspot.action` | HubSpot private app token |
| `trello.action` | Trello API key + token |
| `linear.action` | Linear API key |
| `jira.action` | Atlassian email + API token + Jira domain |
| `github.action` | GitHub token (PAT/app token) with repo scopes |
| `s3.action` | Region, endpoint (for S3-compatible), access key + secret key (or IAM role) |
| `ftp.action` | Protocol, host, port, username/password or SSH private key (+ passphrase optional) |
| `redis.action` | Host, port, optional username/password, TLS mode |
| `mongodb.action` | Connection string or host/port/user/pass (+ auth DB/TLS as needed) |
| `elasticsearch.action` | Base URL, basic auth (username/password) or API key |
| `database.query` | DB host, port, database name, username/password |
| `ssh.action` | Host, port, username, password or private key (+ passphrase optional) |

## Sources

- n8n FTP credentials: https://docs.n8n.io/integrations/builtin/credentials/ftp/
- n8n S3 credentials: https://docs.n8n.io/integrations/builtin/credentials/s3/
- n8n Redis credentials: https://docs.n8n.io/integrations/builtin/credentials/redis/
- n8n MongoDB credentials: https://docs.n8n.io/integrations/builtin/credentials/mongodb/
- n8n Elasticsearch credentials: https://docs.n8n.io/integrations/builtin/credentials/elasticsearch/
- n8n Jira credentials: https://docs.n8n.io/integrations/builtin/credentials/jira/
- AWS S3 request/auth model: https://docs.aws.amazon.com/AmazonS3/latest/API/MakingRequests.html
- AWS SDK credentials overview: https://docs.aws.amazon.com/boto3/latest/guide/credentials.html
- MongoDB connection strings: https://www.mongodb.com/docs/manual/reference/connection-string-formats/
- Slack auth/signing docs: https://docs.slack.dev/authentication/verifying-requests-from-slack/
- Telegram Bot API: https://core.telegram.org/bots/api
- WhatsApp Cloud API overview: https://developers.facebook.com/docs/whatsapp/cloud-api/overview
