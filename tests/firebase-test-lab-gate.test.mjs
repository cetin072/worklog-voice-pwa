import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/firebase-test-lab.yml', 'utf8');

test('Firebase Test Lab physical gate runs for every path-filtered mobile pull request', () => {
  assert.match(workflow, /pull_request:\s*[\s\S]*mobile\/src\/features\/voice\/\*\*/);
  assert.doesNotMatch(workflow, /startsWith\(github\.head_ref, 'fix\/418-'/);
  assert.match(workflow, /name: Confirm Test Lab target is physical Pixel 5/);
  assert.match(workflow, /grep -qi 'physical'/);
  assert.match(workflow, /--type=robo/);
  assert.match(workflow, /model=\$MODEL,version=\$VERSION,locale=ko,orientation=portrait/);
});
