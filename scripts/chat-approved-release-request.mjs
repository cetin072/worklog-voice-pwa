// Narrow bridge: authenticated owner comment -> the existing guarded Production workflow.
// Worklog's manual-only release policy, authorization and Netlify hook remain unchanged.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'cetin072/worklog-voice-pwa';
const CONTROL_ISSUE_NUMBER = 485;
const CONTROL_ISSUE_ID = 6200792630;
const OWNER = 'cetin072';
const WORKFLOW_URL =
  'https://api.github.com/repos/cetin072/worklog-voice-pwa/actions/workflows/production-release.yml/dispatches';

export function approvedReleaseAction(event) {
  if (event?.action !== 'created' || event.repository?.full_name !== REPOSITORY) return null;
  const issue = event.issue, comment = event.comment;
  if (!issue || !comment || issue.number !== CONTROL_ISSUE_NUMBER ||
      issue.id !== CONTROL_ISSUE_ID || issue.state !== 'open' || issue.pull_request ||
      issue.user?.login !== OWNER || comment.user?.login !== OWNER ||
      event.sender?.login !== OWNER || comment.author_association !== 'OWNER') return null;
  if (comment.body === '/worklog deploy-now') return 'deploy-now';
  if (comment.body === '/worklog deploy-check') return 'dry-run';
  return null;
}

export async function requestApprovedRelease(event, { token, fetchImpl = fetch } = {}) {
  const action = approvedReleaseAction(event);
  if (!action) return { status: 'IGNORED' };
  if (!token) throw new Error('GITHUB_ACTIONS_TOKEN_MISSING');

  // Fixed repository, main, workflow and two whitelisted inputs. No tokens or
  // comment-derived strings are passed into a shell command or request URL.
  const response = await fetchImpl(WORKFLOW_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ ref: 'main', inputs: { action } }),
    signal: AbortSignal.timeout(20000)
  });
  // Never retry an ambiguous dispatch: the downstream release is one-shot.
  if (!response.ok) throw new Error(`WORKFLOW_DISPATCH_HTTP_${response.status}`);
  return { status: 'DISPATCH_ACCEPTED', action };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH_MISSING');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const result = await requestApprovedRelease(event, { token: process.env.GH_TOKEN });
  if (result.status !== 'DISPATCH_ACCEPTED') throw new Error('UNAPPROVED_RELEASE_REQUEST');
  console.log(`Existing production-release.yml accepted action=${result.action}; check its own run and published SHA.`);
}
