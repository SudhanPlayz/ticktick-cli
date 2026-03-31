# TickTick CLI v1

A TypeScript CLI wrapper for the TickTick Open API documented at:

- https://developer.ticktick.com/
- https://developer.ticktick.com/docs#/openapi

`v1.0.2` covers the documented OAuth flow plus every documented task and project endpoint.

The CLI is available as both `ticktick` and the short alias `tt`.

## What it covers

- OAuth authorization code flow
- OAuth authorize URL generation
- Get, create, update, complete, delete, move, list-completed, and filter task endpoints
- List, get, create, update, delete, and get-data project endpoints
- Raw authenticated request passthrough
- Local config storage for client credentials and access tokens
- `ticktick` and `dida365` service profiles, with manual base URL overrides when needed

## Install

Requires Node.js `18+`.

Install from the local repo:

```bash
npm install
npm run build
```

Run locally with:

```bash
node dist/bin.js --help
```

Or install the built CLI globally from this directory:

```bash
npm install -g .
ticktick --help
tt --help
```

Once published to npm, install it with:

```bash
npm install -g ticktick-cli
ticktick --help
tt --help
```

All command examples below use `ticktick`, but `tt` works the same way.

## Configure

The CLI reads config in this order:

1. Command flags
2. Environment variables
3. Local config file
4. Built-in defaults

Useful environment variables:

```bash
TICKTICK_SERVICE=ticktick
TICKTICK_CLIENT_ID=...
TICKTICK_CLIENT_SECRET=...
TICKTICK_REDIRECT_URI=http://127.0.0.1:18463/callback
TICKTICK_SCOPES="tasks:read tasks:write"
TICKTICK_ACCESS_TOKEN=...
TICKTICK_API_BASE_URL=https://api.ticktick.com
TICKTICK_AUTH_BASE_URL=https://ticktick.com
TICKTICK_CONFIG_FILE=/custom/path/config.json
```

Default local redirect URI:

```bash
http://127.0.0.1:18463/callback
```

You can also persist config values:

```bash
ticktick config set clientId YOUR_CLIENT_ID
ticktick config set clientSecret YOUR_CLIENT_SECRET
ticktick config set redirectUri http://127.0.0.1:18463/callback
ticktick config show
```

## Auth

Interactive login:

```bash
ticktick auth login
```

Successful auth stores the token in your local config file and masks secrets in the terminal output by default.

If you already have an authorization code:

```bash
ticktick auth exchange YOUR_CODE
```

Print the authorize URL without starting the callback server:

```bash
ticktick auth url
```

Check current auth state:

```bash
ticktick auth status
```

If you need the raw token values in the terminal, add `--show-secrets` to `auth login`, `auth exchange`, or `auth status`.

Clear the stored access token:

```bash
ticktick auth logout
```

## Examples

List projects:

```bash
ticktick project list
```

Get project details:

```bash
ticktick project get 6226ff9877acee87727f6bca
ticktick project data 6226ff9877acee87727f6bca
```

Create a project:

```bash
ticktick project create --name "Inbox" --color "#F18181" --view-mode list --kind TASK
```

Create a task:

```bash
ticktick task create --project-id 6226ff9877acee87727f6bca --title "Ship CLI"
```

Update a task:

```bash
ticktick task update 63b7bebb91c0a5474805fcd4 --project-id 6226ff9877acee87727f6bca --priority 3
```

Move one task:

```bash
ticktick task move \
  --from-project-id 69a850ef1c20d2030e148fdd \
  --to-project-id 69a850f41c20d2030e148fdf \
  --task-id 69a850f8b9061f374d54a046
```

Filter tasks using JSON:

```bash
ticktick task filter --json '{
  "projectIds": ["69a850f41c20d2030e148fdf"],
  "startDate": "2026-03-01T00:58:20.000+0000",
  "endDate": "2026-03-06T10:58:20.000+0000",
  "priority": [0],
  "tag": ["urgent"],
  "status": [0]
}'
```

Move multiple tasks from a file:

```bash
ticktick task move --json-file ./moves.json
```

Pipe JSON into a command:

```bash
echo '{"name":"Planning","kind":"TASK"}' | ticktick project create
```

Send a raw authenticated request:

```bash
ticktick request GET /open/v1/project
```

Send a raw request to a full URL without bearer auth:

```bash
ticktick request POST https://httpbin.org/post --no-auth --json '{"hello":"world"}'
```

## Development

Build the CLI:

```bash
npm run build
```

## Notes

- The docs currently show `api.ticktick.com` for most endpoints, but `api.dida365.com` in the examples for `task/move`, `task/completed`, and `task/filter`. This CLI defaults to the selected service profile and lets you override base URLs explicitly if your account needs something different.
- The CLI writes config to a local JSON file under the OS-specific app config directory unless `--config-file` or `TICKTICK_CONFIG_FILE` is set.
- Access tokens and client secrets are stored as plain text in that config file. That keeps the wrapper simple, but it is not a secure keychain integration.
