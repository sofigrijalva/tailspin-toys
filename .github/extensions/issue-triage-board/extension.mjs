import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
let session;

function json(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 20_000) {
                reject(new Error("Request body is too large."));
                req.destroy();
            }
        });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

async function repositoryName() {
    const { stdout } = await execFileAsync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    const name = stdout.trim();
    if (!name) {
        throw new Error("Could not determine the current GitHub repository.");
    }
    return name;
}

function scoreIssue(issue) {
    const labelNames = issue.labels.map((label) => label.name.toLowerCase());
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    const signals = [];
    let score = 0;

    const urgentLabels = ["bug", "security", "urgent", "high priority", "priority: high", "p0", "p1", "critical"];
    const matchingLabels = labelNames.filter((label) => urgentLabels.some((signal) => label.includes(signal)));
    if (matchingLabels.length) {
        score += Math.min(50, matchingLabels.length * 20);
        signals.push(`priority labels: ${matchingLabels.join(", ")}`);
    }

    const urgentKeywords = ["blocker", "broken", "regression", "crash", "vulnerability", "security", "cannot", "can't"];
    const matchingKeywords = urgentKeywords.filter((keyword) => text.includes(keyword));
    if (matchingKeywords.length) {
        score += Math.min(30, matchingKeywords.length * 8);
        signals.push(`attention keywords: ${matchingKeywords.join(", ")}`);
    }

    const staleDays = Math.max(0, (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000);
    if (staleDays >= 14) {
        const points = Math.min(15, Math.floor(staleDays / 7) * 3);
        score += points;
        signals.push(`no update for ${Math.floor(staleDays)} days`);
    }

    if (issue.comments > 0) {
        const points = Math.min(10, issue.comments);
        score += points;
        signals.push(`${issue.comments} discussion comment${issue.comments === 1 ? "" : "s"}`);
    }

    if (!signals.length) {
        signals.push("no high-priority signal; retained for review");
    }

    return {
        ...issue,
        score,
        justification: signals.slice(0, 3).join("; "),
    };
}

async function loadIssues() {
    const repo = await repositoryName();
    const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,body,url,labels,comments,createdAt,updatedAt,author",
    ]);
    const issues = JSON.parse(stdout);
    return {
        repo,
        issues: issues
            .map((issue) => scoreIssue({ ...issue, body: issue.body ?? "", labels: issue.labels ?? [] }))
            .sort((a, b) => b.score - a.score || Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.number - b.number),
    };
}

function renderHtml() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root {
        color-scheme: light dark;
        --surface: color-mix(in srgb, var(--background-color-default, #ffffff) 94%, var(--text-color-default, #1f2328) 6%);
        --surface-strong: color-mix(in srgb, var(--background-color-default, #ffffff) 87%, var(--text-color-default, #1f2328) 13%);
        --shadow: color-mix(in srgb, var(--text-color-default, #1f2328) 12%, transparent);
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px) var(--font-sans, system-ui, sans-serif); }
      main { max-width: 1100px; margin: auto; padding: clamp(16px, 3vw, 32px); }
      header { align-items: start; border-bottom: 1px solid var(--border-color-default, #d0d7de); display: flex; gap: 16px; justify-content: space-between; margin-bottom: 24px; padding-bottom: 18px; }
      h1 { font-size: clamp(25px, 3vw, 34px); letter-spacing: -0.02em; line-height: 1.1; margin: 0; }
      h2 { font-size: 17px; margin: 0; }
      h3 { font-size: 15px; line-height: 1.3; margin: 0; }
      p { margin: 0; }
      .lede, .meta, .reason { color: var(--text-color-muted, #59636e); }
      .lede { margin-top: 7px; max-width: 70ch; }
      button { appearance: none; background: var(--true-color-blue, #0969da); border: 1px solid var(--true-color-blue, #0969da); border-radius: 7px; color: var(--color-white, #fff); cursor: pointer; font: inherit; font-weight: var(--font-weight-semibold, 600); min-height: 34px; padding: 6px 11px; }
      button:hover:not(:disabled) { filter: brightness(0.9); }
      button:disabled { cursor: wait; opacity: .65; }
      button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      .section { margin-top: 24px; }
      .section-heading { align-items: baseline; display: flex; gap: 10px; margin-bottom: 12px; }
      .count { color: var(--text-color-muted, #59636e); font-size: 12px; }
      .board { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .card { background: var(--surface); border: 1px solid var(--border-color-default, #d0d7de); border-radius: 12px; box-shadow: 0 8px 20px var(--shadow); display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px; }
      .top-card { border-top: 3px solid var(--true-color-orange, #bc4c00); }
      .card-head { align-items: start; display: flex; gap: 10px; justify-content: space-between; }
      .number { color: var(--text-color-muted, #59636e); font-family: var(--font-mono, monospace); font-size: 12px; white-space: nowrap; }
      .body { color: var(--text-color-muted, #59636e); display: -webkit-box; font-size: 13px; line-height: 1.45; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
      .reason { background: var(--surface-strong); border-radius: 7px; font-size: 12px; padding: 9px; }
      .reason strong { color: var(--text-color-default, #1f2328); }
      .meta { font-size: 12px; }
      .labels { display: flex; flex-wrap: wrap; gap: 5px; }
      .label { background: var(--surface-strong); border: 1px solid var(--border-color-default, #d0d7de); border-radius: 999px; font-size: 11px; padding: 2px 7px; }
      .card button { align-self: start; margin-top: auto; }
      .status { color: var(--text-color-muted, #59636e); margin-top: 14px; min-height: 20px; }
      .error { color: var(--true-color-red, #cf222e); }
      .empty { border: 1px dashed var(--border-color-default, #d0d7de); border-radius: 10px; color: var(--text-color-muted, #59636e); padding: 18px; }
      @media (max-width: 560px) { header { flex-direction: column; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div><h1>Issue triage board</h1><p class="lede">Open issues ranked by priority signals, stale age, and discussion volume.</p></div>
        <button id="refresh" type="button">Refresh issues</button>
      </header>
      <div id="status" class="status" role="status" aria-live="polite">Loading open issues...</div>
      <section class="section" aria-labelledby="priority-heading">
        <div class="section-heading"><h2 id="priority-heading">Needs attention now</h2><span id="priority-count" class="count"></span></div>
        <div id="priority" class="board"></div>
      </section>
      <section class="section" aria-labelledby="remaining-heading">
        <div class="section-heading"><h2 id="remaining-heading">Remaining open issues</h2><span id="remaining-count" class="count"></span></div>
        <div id="remaining" class="board"></div>
      </section>
    </main>
    <script>
      const status = document.querySelector("#status");
      const priority = document.querySelector("#priority");
      const remaining = document.querySelector("#remaining");
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
      const excerpt = (value) => String(value ?? "").trim() || "No description provided.";
      const card = (issue, top) => \`<article class="card \${top ? "top-card" : ""}">
        <div class="card-head"><h3><a href="\${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">#\${issue.number}: \${escapeHtml(issue.title)}</a></h3><span class="number">score \${issue.score}</span></div>
        <p class="body">\${escapeHtml(excerpt(issue.body))}</p>
        \${top ? \`<p class="reason"><strong>Why it is here:</strong> \${escapeHtml(issue.justification)}</p>\` : ""}
        <div class="labels">\${issue.labels.map((label) => \`<span class="label">\${escapeHtml(label.name)}</span>\`).join("")}</div>
        <p class="meta">\${issue.comments} comment\${issue.comments === 1 ? "" : "s"} · updated \${new Date(issue.updatedAt).toLocaleDateString()}</p>
        <button type="button" data-number="\${issue.number}">Work on this issue</button>
      </article>\`;
      const load = async () => {
        status.className = "status";
        status.textContent = "Loading open issues...";
        document.querySelector("#refresh").disabled = true;
        try {
          const response = await fetch("/api/issues");
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not load issues.");
          const top = data.issues.slice(0, 3);
          priority.innerHTML = top.length ? top.map((issue) => card(issue, true)).join("") : '<div class="empty">No open issues found.</div>';
          remaining.innerHTML = data.issues.length > 3 ? data.issues.slice(3).map((issue) => card(issue, false)).join("") : '<div class="empty">Nothing else is open.</div>';
          document.querySelector("#priority-count").textContent = top.length + " issue" + (top.length === 1 ? "" : "s");
          document.querySelector("#remaining-count").textContent = Math.max(0, data.issues.length - 3) + " issue" + (data.issues.length - 3 === 1 ? "" : "s");
          status.textContent = "Showing " + data.issues.length + " open issue" + (data.issues.length === 1 ? "" : "s") + " for " + data.repo + ".";
        } catch (error) {
          priority.innerHTML = remaining.innerHTML = '<div class="empty">Issue data is unavailable.</div>';
          status.textContent = error.message;
          status.className = "status error";
        } finally {
          document.querySelector("#refresh").disabled = false;
        }
      };
      document.querySelector("#refresh").addEventListener("click", load);
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-number]");
        if (!button) return;
        button.disabled = true;
        button.textContent = "Adding to context...";
        try {
          const response = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: Number(button.dataset.number) }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not add issue to context.");
          button.textContent = "Added to context";
        } catch (error) {
          button.disabled = false;
          button.textContent = error.message;
        }
      });
      load();
    </script>
  </body>
</html>`;
}

async function startServer() {
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "GET" && req.url === "/") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(renderHtml());
                return;
            }
            if (req.method === "GET" && req.url === "/api/issues") {
                json(res, 200, await loadIssues());
                return;
            }
            if (req.method === "POST" && req.url === "/api/work") {
                const input = JSON.parse(await readBody(req));
                const issueNumber = Number(input.number);
                if (!Number.isInteger(issueNumber) || issueNumber < 1) {
                    json(res, 400, { error: "A valid issue number is required." });
                    return;
                }
                await workOnIssue(issueNumber);
                json(res, 200, { ok: true, number: issueNumber });
                return;
            }
            json(res, 404, { error: "Not found." });
        } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : "Request failed." });
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

async function workOnIssue(issueNumber) {
    if (!session) {
        throw new Error("The Copilot session is not ready.");
    }
    const repo = await repositoryName();
    await session.send({
        prompt: `Work on GitHub issue #${issueNumber} in ${repo}. Start by reviewing the issue details and the repository, then implement the smallest complete fix and validate it.`,
    });
}

session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Rank open GitHub issues and send a selected issue into the current session to work on.",
            actions: [
                {
                    name: "refresh_issues",
                    description: "Load and rank the current repository's open GitHub issues.",
                    handler: async () => loadIssues(),
                },
                {
                    name: "work_on_issue",
                    description: "Add a GitHub issue to the current Copilot session as a focused work request.",
                    inputSchema: {
                        type: "object",
                        properties: { number: { type: "integer", minimum: 1 } },
                        required: ["number"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const issueNumber = ctx.input?.number;
                        if (!Number.isInteger(issueNumber) || issueNumber < 1) {
                            throw new CanvasError("invalid_issue", "A valid issue number is required.");
                        }
                        await workOnIssue(issueNumber);
                        return { ok: true, number: issueNumber };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer();
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
