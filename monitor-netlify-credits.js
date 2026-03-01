// monitor-netlify-credits.js
import { chromium } from 'playwright';

const NETLIFY_EMAIL = process.env.NETLIFY_EMAIL;
const NETLIFY_PASSWORD = process.env.NETLIFY_PASSWORD;
const NETLIFY_TEAM_SLUG = process.env.NETLIFY_TEAM_SLUG; // e.g. "my-team"
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Log in
  await page.goto('https://app.netlify.com/login');
  await page.fill('input[name="email"]', NETLIFY_EMAIL);
  await page.fill('input[name="password"]', NETLIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();

  // Go to billing
  await page.goto(`https://app.netlify.com/teams/${NETLIFY_TEAM_SLUG}/billing/overview`);
  await page.waitForSelector('[data-testid="credit-balance"]', { timeout: 10000 })
    .catch(() => {}); // selector may differ — inspect the page to confirm

  // Extract credit numbers — inspect the actual DOM to get correct selectors
  const creditsUsed = await page.$eval('.credits-used', el => el.textContent.trim())
    .catch(() => 'unknown');
  const creditsTotal = await page.$eval('.credits-total', el => el.textContent.trim())
    .catch(() => 'unknown');

  await browser.close();

  // Post to Slack
  const percent = creditsTotal !== 'unknown'
    ? Math.round((parseInt(creditsUsed) / parseInt(creditsTotal)) * 100)
    : '?';

  const message = {
    text: `📊 *Netlify Credits Update*\n` +
          `Used: *${creditsUsed}* / ${creditsTotal} credits (${percent}%)\n` +
          `<https://app.netlify.com/teams/${NETLIFY_TEAM_SLUG}/billing/overview|View billing dashboard>`
  };

  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  console.log('Posted to Slack:', message.text);
})();
