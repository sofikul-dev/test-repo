// pr-review-bot/index.js

import axios from 'axios';
import dotenv from 'dotenv';
import parse from 'parse-diff';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';

dotenv.config();

// List of required environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'REPO_OWNER',
  'REPO_NAME',
  'PR_NUMBER',
  'GITHUB_TOKEN'
];

// Check for missing environment variables
const missingVars = requiredEnvVars.filter((key) => !process.env[key] || process.env[key].trim() === '');
if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GITHUB_API = 'https://api.github.com';

function getCacheFileName() {
  const { REPO_OWNER, REPO_NAME, PR_NUMBER } = process.env;
  const workspace = process.env.GITHUB_WORKSPACE || '.';
  return path.join(workspace, `.bot-pr-review-${REPO_OWNER}-${REPO_NAME}-pr${PR_NUMBER}.json`);
}


async function getDiffFromCommits(base, head) {
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/compare/${base}...${head}`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3.diff' },
    });
    return res.data;
  } catch (error) {
    console.error(`Error fetching diff from commits: ${error.message}`);
    throw error;
  }
}

async function generateCommentsFromLLM(diff) {
  const prompt = `You are a senior code reviewer.

Review ONLY the provided diff.
- Focus on null checks, error handling, security, performance, or clarity issues.
- Provide max 3 critical review comments.

Respond in JSON:

{"comments":[{"context":"<code snippet or key line>","comment":"<issue>","suggestion":"<fix>"}]}

Do not include markdown fences.

Diff:
${diff}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  let content = completion.choices[0].message.content;
  content = content.replace(/```json|```/g, '').trim();

  return JSON.parse(content);
}

function mapCommentsToDiff(diff, llmComments) {
  const files = parse(diff);
  const mapped = [];

  for (const comment of llmComments) {
    let codeContext = comment.context.trim().toLowerCase();
    let matched = false;

    // Extract key phrases
    let keyPhrases = [];
    if (codeContext.includes('{ ... }')) {
      keyPhrases.push(codeContext.replace('{ ... }', '').trim());
    }
    if (codeContext.length > 30 || keyPhrases.length === 0) {
      const regex = /([a-zA-Z0-9_\.]+\([^)]+\))|([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)|([a-zA-Z0-9_]+\s*===\s*[^\s]+)/g;
      let match;
      while ((match = regex.exec(codeContext)) !== null) {
        keyPhrases.push(match[0]);
      }
      keyPhrases.push(codeContext.slice(0, 30));
    } else {
      keyPhrases = [codeContext];
    }

    for (const file of files) {
      for (const chunk of file.chunks) {
        for (const change of chunk.changes) {
          if (change.add) {
            const lineContent = change.content.trim().toLowerCase();
            keyPhrases.sort((a, b) => b.length - a.length);
            let found = false;
            for (const phrase of keyPhrases) {
              if (phrase && lineContent.includes(phrase)) {
                mapped.push({
                  path: file.to,
                  line: change.ln,
                  side: 'RIGHT',
                  body: `Issue: ${comment.comment}\n\n**Suggestion:** ${comment.suggestion}`,
                });
                matched = true;
                found = true;
                break;
              }
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (matched) break;
    }

    if (!matched) {
      console.warn(`Could not map: ${comment.context}`);
    }
  }

  return mapped;
}

async function submitReview(mappedComments, mode = 'REQUEST_CHANGES') {
  const { REPO_OWNER, REPO_NAME, PR_NUMBER, GITHUB_TOKEN } = process.env;

  const payload = {
    event: mode,
    body: mode === 'APPROVE'
      ? "Automated review: All previous issues are resolved. Approving PR."
      : "Automated PR review found critical issues. See inline comments.",
  };

  if ((mode === 'REQUEST_CHANGES' || mode === 'COMMENT') && mappedComments && mappedComments.length > 0) {
    payload.comments = mappedComments;
  }

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`;

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    console.log(`Review submitted: ${res.data.id}, Mode: ${mode}`);
  } catch (error) {
    console.error(`Error submitting review: ${error.name} ${error.message}`, error.stack);
    throw error;
  }
}

function saveReviewCache(data) {
  const fileName = getCacheFileName();
  console.log(`Saving data ${JSON.stringify(data)}`);
  console.log(`Saving review cache to ${fileName}`);
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
}

async function getPrDetails() {
  const { REPO_OWNER, REPO_NAME, PR_NUMBER, GITHUB_TOKEN } = process.env;
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}`;

  const res = await axios.get(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });

  return res.data;
}


async function loadReviewCache() {
  const fileName = getCacheFileName();
  console.log(`Loading review cache from ${fileName}`);
  if (fs.existsSync(fileName)) {
    console.log(`Cache file exists: ${fileName}`);
    try {
      const data = await fs.promises.readFile(fileName, 'utf8');
      if (!data) {
        console.log(`Cache file ${fileName} is empty.`);
        return null;
      }
      let dataJson;
      try {
        dataJson = JSON.parse(data);
        console.log('review cache data:', dataJson);
        return dataJson;
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError.message);
        return null;
      }
    } catch (err) {
      console.error(`Error parsing cache file ${fileName}:`, err.message);
      return null;
    }
  }
  return null;
}
async function main() {
  try {
    const prDetails = await getPrDetails();
    const currentSha = prDetails.head.sha;

     saveReviewCache({ last_commit: '954e5d43af10d2cb37a6621cd0d3c609f408e91a', previous_comments: [] });
    let previousCache = await loadReviewCache();
    console.log(`Loaded previous cache: ${JSON.stringify(previousCache)}`);
    let baseSha;

    if (!previousCache) {
      console.log('First review - using base branch sha for diff.');
      baseSha = prDetails.base.sha;
    } else if (previousCache.last_commit === currentSha) {
      console.log('No new commits since last review. Skipping.');
      return;
    } else {
      console.log('Re-review - using last reviewed commit for diff.');
      baseSha = previousCache.last_commit;
    }

    const diff = await getDiffFromCommits(baseSha, currentSha);
    const { comments } = await generateCommentsFromLLM(diff);
    const mapped = mapCommentsToDiff(diff, comments);

    if (!previousCache) {
      console.log('First review - saving all comments.', { last_commit: currentSha, previous_comments: mapped });
      saveReviewCache({ last_commit: currentSha, previous_comments: mapped });
      await submitReview(mapped, mapped.length > 0 ? 'REQUEST_CHANGES' : 'APPROVE');
    } else {
      const previousLines = previousCache.previous_comments.map(c => ({ path: c.path, line: c.line }));
      const relevantFixes = mapped.filter(c => previousLines.some(prev => prev.path === c.path && prev.line === c.line));

      if (relevantFixes.length === 0) {
        console.log('All previous issues are resolved. Approving.');
        saveReviewCache({ last_commit: currentSha, previous_comments: [] });
        await submitReview(undefined, 'APPROVE'); // <-- Pass undefined instead of []
      } else {
        console.log('Some issues still remain. Requesting changes again.');
        saveReviewCache({ last_commit: currentSha, previous_comments: relevantFixes });
        await submitReview(relevantFixes, 'REQUEST_CHANGES');
      }
    }
  } catch (err) {
    console.error('Error in main function:', err.message, err.stack);
  }
}

main();
