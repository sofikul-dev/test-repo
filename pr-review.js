// pr-review-bot/index.js

import axios from 'axios';
import dotenv from 'dotenv';
import parse from 'parse-diff';
import { OpenAI } from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GITHUB_API = 'https://api.github.com';

async function getPrDiff() {
  const { REPO_OWNER, REPO_NAME, PR_NUMBER, GITHUB_TOKEN } = process.env;
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}`;

  const res = await axios.get(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3.diff' },
  });

  return res.data;
}

async function generateCommentsFromLLM(diff) {
  const prompt = `You are a senior code reviewer.

Review ONLY the provided diff.
- Focus on **null checks, error handling, security, performance, or clarity issues**.
- **DO NOT assume problems with class design, static vs instance methods, or unrelated code unless explicitly shown in the diff.**
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

    // Extract key phrases for matching
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
    event: mode, // 'REQUEST_CHANGES' or 'APPROVE'
    body: mode === 'APPROVE'
      ? 'All issues are resolved. Approving the PR ✅'
      : 'Automated PR review found critical issues. See inline comments.',
    comments: mode === 'REQUEST_CHANGES' ? mappedComments : undefined,
  };

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`;

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });

  console.log(`Review submitted: ${res.data.id}, Mode: ${mode}`);
}

async function main() {
  try {
    const diff = await getPrDiff();
    const { comments } = await generateCommentsFromLLM(diff);
    const filteredComments = comments.filter(c => {
      const text = c.comment.toLowerCase();
      return !(text.includes('class') && text.includes('instance')) &&
             !(text.includes('static method'));
    });

    console.log('Generated Comments:', filteredComments);

    const mapped = mapCommentsToDiff(diff, filteredComments);
    console.log('Mapped Comments:', mapped);

    if (mapped.length > 0) {
      await submitReview(mapped, 'REQUEST_CHANGES');
    } else {
      await submitReview([], 'APPROVE');
    }

  } catch (err) {
    console.error(err.message);
  }
}

main();
